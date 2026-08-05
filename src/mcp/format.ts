import type { McpServiceCatalogItem, McpServiceDetails, McpSessionDisclosure, McpToolCallResult } from "@/mcp/contracts";

/** 将 MCP 服务目录格式化为 Harness 中的精简清单，不包含 endpoint。 */
export function formatMcpCatalog(catalog: McpServiceCatalogItem[]): string {
  if (catalog.length === 0) return "（当前没有已添加的 MCP 服务）";
  return catalog
    .map((service) => `- ${service.serviceId}：${service.displayName}；${service.description}；${service.toolCount} 个 Tool`)
    .join("\n");
}

/** 将当前会话已披露 MCP 服务格式化为 Harness 状态。 */
export function formatMcpSessionDisclosures(disclosures: McpSessionDisclosure[]): string {
  if (disclosures.length === 0) return "当前会话尚未披露 MCP 服务详情。";
  return [
    "当前会话已披露 MCP 服务：",
    ...disclosures.map((item) => `- ${item.serviceId}：${item.displayName}；摘要 ${item.detailSummary.slice(0, 12)}`)
  ].join("\n");
}

/** 将 MCP 详情读取结果格式化为模型可继续使用的中文反馈。 */
export function formatMcpDetailsBatch(results: Array<{ serviceId: string; details: McpServiceDetails }>): string {
  const sections = results.map((result, index) => {
    const tools = result.details.tools.map((tool) => [
      `- ${tool.name}${tool.title ? `（${tool.title}）` : ""}`,
      tool.description ? `  描述：${tool.description}` : undefined,
      `  inputSchema：${stableJson(tool.inputSchema)}`
    ].filter(Boolean).join("\n")).join("\n");
    return [
      `${index + 1}. MCP 服务：${result.serviceId}`,
      "",
      `名称：${result.details.serverName}`,
      ...(result.details.serverTitle ? [`标题：${result.details.serverTitle}`] : []),
      ...(result.details.serverVersion ? [`版本：${result.details.serverVersion}`] : []),
      ...(result.details.instructions ? [`Instructions：${result.details.instructions}`] : []),
      `协议：${result.details.protocolEra === "modern" ? "2026" : "2025"}`,
      `详情摘要：${result.details.detailSummary}`,
      "",
      "Tool 目录：",
      tools
    ].join("\n");
  });
  return ["我把你请求的 MCP 服务详情放在下面了：", "", ...sections].join("\n");
}

/** 格式化 MCP 读取请求纠正反馈。 */
export function formatMcpCorrection(error: string): string {
  return `这批 mcp 请求的写法不对，我没有读取。请按前面的格式整批重新发给我。\n\n具体错误：${error}`;
}

/** 格式化一次 MCP Tool 调用结果。 */
export function formatMcpToolCallResult(result: McpToolCallResult): string {
  const fence = markdownFenceFor(result.content);
  const prefix = result.isError
    ? `MCP Tool \`${result.serviceId}/${result.toolName}\` 返回失败：`
    : result.contentType === "yaml"
      ? `MCP Tool \`${result.serviceId}/${result.toolName}\` 返回结构化结果：`
      : `MCP Tool \`${result.serviceId}/${result.toolName}\` 返回文本结果：`;
  const language = result.contentType === "yaml" ? "yaml" : "";
  const closingPrefix = result.content.endsWith("\n") ? "" : "\n";
  return `${prefix}\n\n${fence}${language}\n${result.content}${closingPrefix}${fence}`;
}

function stableJson(value: unknown): string {
  return stableStringify(value);
}

function markdownFenceFor(content: string): string {
  const longestRun = Math.max(0, ...Array.from(content.matchAll(/`+/gu), (match) => match[0].length));
  return "`".repeat(Math.max(3, longestRun + 1));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(",")}}`;
}
