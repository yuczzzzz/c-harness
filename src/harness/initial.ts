import type { McpServiceCatalogItem, McpSessionDisclosure } from "@/mcp/contracts";
import { formatMcpCatalog, formatMcpSessionDisclosures } from "@/mcp/format";
import { displayLocalEnvironmentMcpName, selectLocalEnvironmentMcp } from "@/mcp/local-environment";
import type { SkillMetadata } from "@/skills/contracts";
import type { SessionToolKnowledgeState } from "@/session-knowledge/state";
import { formatSessionKnowledgeState } from "@/harness/session-knowledge";

export interface InitialHarnessOptions {
  skillEnabled: boolean;
  mcpEnabled: boolean;
  operatingSystem?: HarnessOperatingSystem;
}

export type HarnessOperatingSystem = "windows" | "macos" | "linux" | "other";

/** 构建一条包含规则、当前目录和原始问题的可见 DeepSeek 消息。 */
export function buildInitialHarness(
  catalog: SkillMetadata[],
  question: string,
  sessionKnowledge?: SessionToolKnowledgeState,
  mcpCatalog: McpServiceCatalogItem[] = [],
  mcpDisclosures: McpSessionDisclosure[] = [],
  options: InitialHarnessOptions = { skillEnabled: true, mcpEnabled: true }
): string {
  const { skillEnabled, mcpEnabled, operatingSystem = "other" } = options;
  const localEnvironmentMcp = mcpEnabled ? selectLocalEnvironmentMcp(mcpCatalog).selected : null;
  const skillCatalog = catalog.length === 0
    ? "（当前没有已导入的 Skill）"
    : catalog.map((skill) => `- ${skill.name}：${skill.description}`).join("\n");
  const skillRule = sessionKnowledge
    ? "如需 Skill，可跨多轮按需读取；每块正文必须是只包含 name 字段的 YAML mapping："
    : "第一阶段如需 Skill，请一次列出当前问题需要的全部 Skill；每块正文必须是只包含 name 字段的 YAML mapping：";
  const referenceRule = sessionKnowledge
    ? "如需 Reference，可跨多轮按需读取；路径必须属于本会话已读或本任务此前读取的 Skill；每块正文必须是只包含 path 字段的 YAML mapping："
    : "第二阶段如需 Reference，请一次列出全部规范虚拟路径，路径必须属于已经选择的 Skill；每块正文必须是只包含 path 字段的 YAML mapping：";

  return [
    "我们按下面的约定完成这次问题：",
    "",
    openingRule(skillEnabled, mcpEnabled),
    "",
    ...operatingSystemPrompt(operatingSystem),
    ...(skillEnabled ? [
      skillRule,
      "```skill",
      "name: skill-name",
      "```",
      "",
      referenceRule,
      "```read",
      "path: skill-name/references/file.md",
      "```",
      ""
    ] : []),
    ...(mcpEnabled ? [
      "如需 MCP 服务详情，可按需批量读取；每块正文必须是只包含 server 字段的 YAML mapping。读取详情前不要猜测 Tool Schema，也不要请求或输出 endpoint：",
      "```mcp",
      "server: service-id",
      "```",
      "",
      "服务详情披露后，如需调用 MCP Tool，只能使用下面格式；arguments 必须是 YAML mapping，不能使用数组、alias、anchor、tag 或非 JSON 数字。arguments 中的多行字符串必须使用 YAML 块标量 `|`，禁止在单引号或双引号字符串中直接换行。每轮最多一个 mcp-call，且不能混用其他命令。调用前我会要求用户确认：",
      "```mcp-call",
      "server: service-id",
      "tool: tool-name",
      "arguments:",
      "  command: |",
      "    first command",
      "    second command",
      "```",
      ""
    ] : []),
    ...(localEnvironmentMcp ? [
      `当我提到文件/本地/工作区/发送了文件目录，或者需要读写本地文件/Skill 时，使用${displayLocalEnvironmentMcpName(localEnvironmentMcp)}从本地环境获取。`,
      `需要通过 bash 执行命令时，必须先执行命令查询本地开发环境情况(如: 是否存在python/node环境, 是否已安装能解决问题的工具)，一次尽可能查询多种工具。
如果本地开发环境能够满足需求, 则直接执行对应命令。只有本地开发环境无法满足需求时，才向我确认是否安装其他程序；得到确认前不得安装。`,
      ...(skillEnabled ? ["在获取任何 Skill 前，必须先与我确认 Skill 来源；来源确认前不得发送任何 Harness 命令，只能先进行来源确认。"] : []),
      ""
    ] : []),
    ...(skillEnabled ? ["当前 Skill 目录：", skillCatalog, ""] : []),
    ...(mcpEnabled ? [
      "当前 MCP 服务目录：",
      formatMcpCatalog(mcpCatalog),
      "",
      formatMcpSessionDisclosures(mcpDisclosures),
      ""
    ] : []),
    ...(skillEnabled && sessionKnowledge ? [formatSessionKnowledgeState(sessionKnowledge), ""] : []),
    "约定到这里。不用复述或确认，直接处理我这次的问题：",
    "",
    question
  ].join("\n");
}

function operatingSystemPrompt(operatingSystem: HarnessOperatingSystem): string[] {
  const displayName = {
    windows: "Windows",
    macos: "macOS",
    linux: "Linux",
    other: "其他或未知系统"
  }[operatingSystem];
  return [
    `用户当前系统：${displayName}。`,
    ...(operatingSystem === "windows"
      ? ["仅支持 Git Bash 命令，不支持 Windows 命令行 和 PowerShell。"]
      : []),
    ""
  ];
}

function openingRule(skillEnabled: boolean, mcpEnabled: boolean): string {
  const abilities = [
    ...(skillEnabled ? ["本地 Skill", "Reference"] : []),
    ...(mcpEnabled ? ["MCP"] : [])
  ].join("、");
  return `正常使用自然语言交流。需要${abilities}时，只能使用显式 Markdown 命令块。一个代码块只放一个请求，正文必须是严格 YAML mapping；同一回复可以有多个相同标签的代码块，但不能混用标签。发出请求后等待我返回真实内容，不要假设读取成功。普通文字、无标签代码块和未知标签代码块都不是读取请求。没有有效读取请求的回复就是最终回答。`;
}
