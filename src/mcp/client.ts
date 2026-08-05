import { Client, StreamableHTTPClientTransport, type Tool } from "@modelcontextprotocol/client";
import { stringify } from "yaml";

import { MCP_LIMITS, type McpServiceDetails, type McpToolCallResult, type McpToolSummary } from "@/mcp/contracts";

/** 连接 MCP Streamable HTTP 服务并读取完整 Tool 详情。 */
export async function discoverMcpEndpoint(endpoint: string): Promise<McpServiceDetails> {
  const client = new Client(
    { name: "c-harness", version: "0.1.0" },
    {
      versionNegotiation: { mode: "auto" },
      listMaxPages: MCP_LIMITS.maxToolsPerService
    }
  );
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  try {
    // Step 1：连接阶段交给官方 SDK 自动协商现代/旧协议。
    await client.connect(transport, { timeout: MCP_LIMITS.connectTimeoutMs });

    // Step 2：一次读取完整 Tool 目录，并在回传前执行容量限制。
    const result = await client.listTools(undefined, { timeout: MCP_LIMITS.connectTimeoutMs });
    if (result.tools.length === 0) throw new Error("MCP 服务未提供 Tool。");
    if (result.tools.length > MCP_LIMITS.maxToolsPerService) {
      throw new Error(`MCP 服务最多支持 ${MCP_LIMITS.maxToolsPerService} 个 Tool。`);
    }

    // Step 3：整理可持久化摘要，避免把 SDK 对象形态扩散到业务层。
    const serverVersion = client.getServerVersion();
    const detailsWithoutSummary = {
      serverName: serverVersion?.name ?? new URL(endpoint).hostname,
      serverVersion: serverVersion?.version,
      instructions: client.getInstructions(),
      tools: result.tools.map(summarizeTool),
      protocolEra: client.getProtocolEra() === "modern" ? "modern" : "legacy"
    } satisfies Omit<McpServiceDetails, "detailSummary" | "detailBytes">;
    const detailBytes = byteLength(stableStringify(detailsWithoutSummary));
    if (detailBytes > MCP_LIMITS.maxDetailBytes) {
      throw new Error(`MCP 服务详情超过 ${MCP_LIMITS.maxDetailBytes / 1024} KiB 限制。`);
    }
    return {
      ...detailsWithoutSummary,
      detailBytes,
      detailSummary: await sha256(stableStringify(detailsWithoutSummary))
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** 调用一个已解析 endpoint 上的 MCP Tool，并将文本或结构化结果归一化为可回填内容。 */
export async function callMcpEndpointTool(
  endpoint: string,
  serviceId: string,
  detailSummary: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolCallResult> {
  const client = new Client(
    { name: "c-harness", version: "0.1.0" },
    { versionNegotiation: { mode: "auto" } }
  );
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  try {
    // Step 1：每次调用都创建短生命周期 Client，避免 Service Worker 保存长任务状态。
    await client.connect(transport, { timeout: MCP_LIMITS.connectTimeoutMs });

    // Step 2：结构化结果优先于兼容性文本；没有结构化结果时才校验纯文本内容。
    const result = await client.callTool(
      { name: toolName, arguments: args },
      { timeout: MCP_LIMITS.callTimeoutMs }
    );
    const normalized = result.structuredContent === undefined
      ? normalizeTextContent(result.content)
      : normalizeStructuredContent(result.structuredContent);
    if (byteLength(normalized.content) > MCP_LIMITS.maxToolResultBytes) {
      throw new Error(`MCP Tool 结果超过 ${MCP_LIMITS.maxToolResultBytes / 1024} KiB 限制。`);
    }
    return {
      serviceId,
      toolName,
      ...normalized,
      isError: result.isError === true,
      detailSummary
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

function normalizeTextContent(content: unknown): Pick<McpToolCallResult, "content" | "contentType"> {
  if (!Array.isArray(content)) throw new Error("MCP Tool 返回结果格式无效。");
  const parts = content.map((item) => {
    if (!isTextContent(item)) throw new Error("MCP Tool 返回了暂不支持的结果类型。");
    return item.text;
  });
  return { content: parts.join("\n"), contentType: "text" };
}

function normalizeStructuredContent(content: unknown): Pick<McpToolCallResult, "content" | "contentType"> {
  if (!isRecord(content)) throw new Error("MCP Tool structuredContent 必须是对象。");
  return {
    content: stringify(content, { lineWidth: 0, sortMapEntries: true }).trimEnd(),
    contentType: "yaml"
  };
}

function summarizeTool(tool: Tool): McpToolSummary {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema ?? {}
  };
}

function isTextContent(value: unknown): value is { type: "text"; text: string } {
  return typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "text" &&
    typeof (value as { text?: unknown }).text === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
