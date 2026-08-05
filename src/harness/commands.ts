import { formatMcpDetailsBatch } from "@/mcp/format";
import type { McpServiceDetails, McpToolCallRequest } from "@/mcp/contracts";
import type { ReferenceReadResult, SkillReadResult } from "@/skills/contracts";
import { isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml";
import type { Node, ParsedNode } from "yaml";

export const HARNESS_COMMAND_KINDS = ["skill", "read", "mcp", "mcp-call"] as const;
export type HarnessCommandKind = typeof HARNESS_COMMAND_KINDS[number];

export type CommandBatch =
  | { kind: "none" }
  | { kind: "skill"; requests: string[] }
  | { kind: "read"; requests: string[] }
  | { kind: "mcp"; requests: string[] }
  | { kind: "mcp-call"; request: McpToolCallRequest }
  | { kind: "invalid"; code: "MIXED_LABELS" | "DUPLICATE_REQUEST" | "MALFORMED_BODY" | "UNCLOSED_FENCE" };

/** 仅解析显式围栏 Harness 命令，使普通 Markdown 保持惰性。 */
export function parseCommandBatch(reply: string): CommandBatch {
  const lines = reply.replace(/\r\n?/gu, "\n").split("\n");
  const commands: Array<
    | { kind: "skill" | "read" | "mcp"; request: string }
    | { kind: "mcp-call"; request: McpToolCallRequest }
  > = [];

  // 步骤 1：遍历完整的 Markdown 围栏，将未知围栏视为不透明内容。
  for (let index = 0; index < lines.length; index += 1) {
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(lines[index] ?? "");
    if (!opening) continue;
    const fence = opening[1]!;
    const label = opening[2]!.trim();
    const kind = label === "skill" || label === "read" || label === "mcp" || label === "mcp-call" ? label : null;
    const closingPattern = new RegExp(`^ {0,3}${escapeRegExp(fence[0]!)}{${fence.length},}[ \\t]*$`, "u");
    let closingIndex = index + 1;
    while (closingIndex < lines.length && !closingPattern.test(lines[closingIndex] ?? "")) {
      closingIndex += 1;
    }
    if (closingIndex >= lines.length) {
      if (kind) return { kind: "invalid", code: "UNCLOSED_FENCE" };
      break;
    }
    if (kind) {
      const request = lines.slice(index + 1, closingIndex).join("\n").trim();
      const parsed = parseYamlCommandBody(kind, request);
      if (!parsed) return { kind: "invalid", code: "MALFORMED_BODY" };
      commands.push(parsed);
    }
    index = closingIndex;
  }

  // 步骤 2：返回任何请求前，校验完整的已识别批次。
  if (commands.length === 0) return { kind: "none" };
  const kinds = new Set(commands.map((command) => command.kind));
  if (kinds.size > 1) return { kind: "invalid", code: "MIXED_LABELS" };
  if (commands[0]!.kind === "mcp-call") {
    if (commands.length > 1) return { kind: "invalid", code: "MALFORMED_BODY" };
    return { kind: "mcp-call", request: commands[0]!.request as McpToolCallRequest };
  }
  const requests = commands.map((command) => command.request);
  if (new Set(requests).size !== requests.length) return { kind: "invalid", code: "DUPLICATE_REQUEST" };
  return { kind: commands[0]!.kind, requests: requests as string[] };
}

/** 将有序 Skill 内容格式化为固定的对话反馈，并无损保留 Markdown 正文。 */
export function formatSkillBatch(results: SkillReadResult[]): string {
  const sections = results.map((result, index) => {
    const fence = markdownFenceFor(result.content);
    const closingPrefix = result.content.endsWith("\n") ? "" : "\n";
    return `${index + 1}. Skill：${result.skillName}\n\n${fence}\n${result.content}${closingPrefix}${fence}`;
  });
  return ["我把你需要的 Skill 使用说明都放在下面了：", "", ...sections].join("\n");
}

/** 将有序 Reference 内容格式化为固定的对话反馈，并无损保留 Markdown 正文。 */
export function formatReferenceBatch(results: ReferenceReadResult[]): string {
  const sections = results.map((result, index) => {
    const fence = markdownFenceFor(result.content);
    const closingPrefix = result.content.endsWith("\n") ? "" : "\n";
    return `${index + 1}. Reference：${result.virtualPath}\n\n${fence}\n${result.content}${closingPrefix}${fence}`;
  });
  return ["我把你需要的参考资料都放在下面了：", "", ...sections].join("\n");
}

/** 将 MCP 详情批次格式化为固定对话反馈。 */
export function formatMcpBatch(results: Array<{ serviceId: string; details: McpServiceDetails }>): string {
  return formatMcpDetailsBatch(results);
}

/** 格式化 Skill 或 Reference 请求唯一允许的一次全批次纠正反馈。 */
export function formatBatchCorrection(kind: "skill" | "read", error: string): string {
  return `这批 ${kind} 请求的写法不对，我没有读取。请按前面的格式整批重新发给我。\n\n具体错误：${error}`;
}

/** 格式化渐进模式无法识别有效请求类型时唯一的一次全批次纠正反馈。 */
export function formatProgressiveBatchCorrection(error: string): string {
  return `这批 skill/read 请求的写法不对，我没有读取。请按前面的格式整批重新发给我。\n\n具体错误：${error}`;
}

/** 格式化所有 Reference 回注后唯一允许的一次直接回答提醒。 */
export function formatFinalAnswerCorrection(): string {
  return "资料已经全部提供，请不要再发读取请求，直接根据现有内容回答问题。";
}

function markdownFenceFor(content: string): string {
  const longestRun = Math.max(0, ...Array.from(content.matchAll(/`+/gu), (match) => match[0].length));
  return "`".repeat(Math.max(3, longestRun + 1));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function parseYamlCommandBody(
  kind: HarnessCommandKind,
  body: string
):
  | { kind: "skill" | "read" | "mcp"; request: string }
  | { kind: "mcp-call"; request: McpToolCallRequest }
  | null {
  const fields = parseStrictYamlMapping(body);
  if (!fields) return null;
  if (kind === "skill") {
    const name = readOnlyStringField(fields, ["name"], "name");
    return name ? { kind, request: name } : null;
  }
  if (kind === "read") {
    const path = readOnlyStringField(fields, ["path"], "path");
    return path ? { kind, request: path } : null;
  }
  if (kind === "mcp") {
    const server = readOnlyStringField(fields, ["server"], "server");
    return server ? { kind, request: server } : null;
  }
  if (!hasOnlyFields(fields, ["server", "tool", "arguments"])) return null;
  const serviceId = readStringField(fields, "server");
  const toolName = readStringField(fields, "tool");
  const argumentsNode = fields.get("arguments");
  const args = argumentsNode ? yamlMappingToJsonObject(argumentsNode) : null;
  if (!serviceId || !toolName || !args) return null;
  return { kind, request: { serviceId, toolName, arguments: args } };
}

function parseStrictYamlMapping(body: string): Map<string, ParsedNode | null> | null {
  if (!body) return null;
  const document = parseDocument(body, {
    intAsBigInt: false,
    keepSourceTokens: true,
    merge: false,
    uniqueKeys: true
  });
  if (document.errors.length > 0 || !document.contents || !isMap(document.contents)) return null;
  if (containsUnsafeYamlNode(document.contents)) return null;
  return yamlMapFields(document.contents);
}

function yamlMapFields(map: Node): Map<string, ParsedNode | null> | null {
  if (!isMap(map)) return null;
  const fields = new Map<string, ParsedNode | null>();
  for (const pair of map.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string") return null;
    const key = pair.key.value;
    if (key === "<<") return null;
    if (fields.has(key)) return null;
    fields.set(key, pair.value as ParsedNode | null);
  }
  return fields;
}

function containsUnsafeYamlNode(node: Node | null): boolean {
  if (!node) return false;
  if (isAlias(node) || node.tag || ("anchor" in node && typeof node.anchor === "string")) return true;
  if (isMap(node)) {
    return node.items.some((pair) => containsUnsafeYamlNode(pair.key as Node | null) || containsUnsafeYamlNode(pair.value as Node | null));
  }
  if (isSeq(node)) return node.items.some((item) => containsUnsafeYamlNode(item as Node | null));
  return false;
}

function readOnlyStringField(fields: Map<string, ParsedNode | null>, expected: string[], name: string): string | null {
  if (!hasOnlyFields(fields, expected)) return null;
  return readStringField(fields, name);
}

function hasOnlyFields(fields: Map<string, ParsedNode | null>, expected: string[]): boolean {
  return fields.size === expected.length && expected.every((name) => fields.has(name));
}

function readStringField(fields: Map<string, ParsedNode | null>, name: string): string | null {
  const node = fields.get(name);
  if (!node || !isScalar(node) || typeof node.value !== "string") return null;
  const value = node.value.trim();
  if (!value || value.includes("\n") || value.includes("\r")) return null;
  return value;
}

function yamlMappingToJsonObject(node: ParsedNode): Record<string, unknown> | null {
  if (!isMap(node)) return null;
  const fields = yamlMapFields(node);
  if (!fields) return null;
  const result: Record<string, unknown> = {};
  for (const [key, valueNode] of fields) {
    const value = yamlNodeToJsonValue(valueNode);
    if (value === undefined) return null;
    result[key] = value;
  }
  return result;
}

function yamlNodeToJsonValue(node: ParsedNode | null): unknown {
  if (!node) return null;
  if (isScalar(node)) {
    const value = node.value;
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) {
      return value;
    }
    return undefined;
  }
  if (isMap(node)) return yamlMappingToJsonObject(node) ?? undefined;
  return undefined;
}
