import type { RuntimeOperatingSystem, RuntimeResponse } from "@/runtime/contracts";
import type { McpServiceCatalogItem, McpServiceDetails, McpSessionDisclosure, McpToolCallResult } from "@/mcp/contracts";
import type { GeneralSettings } from "@/settings/store";
import type { ReferenceReadResult, SkillMetadata, SkillReadResult } from "@/skills/contracts";
import type { SkillProvider } from "@/skills/provider";

/** 通过扩展 Service Worker 读取 Chrome 当前运行的操作系统。 */
export async function loadCurrentOperatingSystem(): Promise<RuntimeOperatingSystem> {
  const response = (await sendRuntimeMessage({ type: "platform.get" })) as RuntimeResponse<RuntimeOperatingSystem>;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

/** 完整校验请求后，通过扩展 Service Worker 读取 Reference 文件。 */
export async function loadReferenceBatch(
  virtualPaths: string[],
  selectedSkillNames: string[]
): Promise<ReferenceReadResult[]> {
  const response = (await sendRuntimeMessage({
    type: "reference.readBatch",
    selectedSkillNames,
    virtualPaths
  })) as RuntimeResponse<ReferenceReadResult[]>;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

/** 通过渐进式项目 Reference 端点读取 Reference 文件。 */
export async function loadProgressiveReferenceBatch(
  virtualPaths: string[],
  selectedSkillNames: string[]
): Promise<ReferenceReadResult[]> {
  const response = (await sendRuntimeMessage({
    type: "reference.readProgressiveBatch",
    selectedSkillNames,
    virtualPaths
  })) as RuntimeResponse<ReferenceReadResult[]>;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

/** 通过扩展 Service Worker 读取已导入的 Skill 正文。 */
export async function loadSkillBatch(skillNames: string[]): Promise<SkillReadResult[]> {
  const response = (await sendRuntimeMessage({
    type: "skill.readBatch",
    skillNames
  })) as RuntimeResponse<SkillReadResult[]>;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

/** 通过扩展 Service Worker 加载当前已导入的 Skill 目录。 */
export async function loadCatalog(): Promise<SkillMetadata[]> {
  const response = (await sendRuntimeMessage({ type: "catalog.get" })) as RuntimeResponse<SkillMetadata[]>;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

/** 通过扩展 Service Worker 加载当前通用设置。 */
export async function loadGeneralSettings(): Promise<GeneralSettings> {
  const response = (await sendRuntimeMessage({ type: "settings.get" })) as RuntimeResponse<GeneralSettings>;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

/** 更新通用设置中的自动回注延迟区间。 */
export async function updateReinjectionDelaySettings(minSeconds: number, maxSeconds: number): Promise<GeneralSettings> {
  const response = (await sendRuntimeMessage({
    type: "settings.reinjectionDelay.update",
    minSeconds,
    maxSeconds
  })) as RuntimeResponse<GeneralSettings>;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

/** 通过扩展 Service Worker 加载目标网站可见的 MCP 服务目录。 */
export async function loadMcpServiceCatalog(): Promise<McpServiceCatalogItem[]> {
  const response = (await sendRuntimeMessage({ type: "mcp.serviceCatalog.get" })) as RuntimeResponse<McpServiceCatalogItem[]>;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

/** 读取 MCP 服务详情，内容脚本只传服务 ID。 */
export async function loadMcpDetailsBatch(serviceIds: string[]): Promise<Array<{ serviceId: string; details: McpServiceDetails }>> {
  const response = (await sendRuntimeMessage({ type: "mcp.details.readBatch", serviceIds })) as RuntimeResponse<Array<{
    serviceId: string;
    details: McpServiceDetails;
  }>>;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

/** 查询当前站点会话已经披露的 MCP 服务详情。 */
export async function loadMcpSessionDisclosures(sessionId: string): Promise<McpSessionDisclosure[]> {
  const response = (await sendRuntimeMessage({
    type: "mcp.session.disclosures.get",
    sessionId
  })) as RuntimeResponse<McpSessionDisclosure[]>;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

/** 提交当前站点会话刚刚成功披露的 MCP 服务详情。 */
export async function commitMcpSessionDisclosures(sessionId: string, serviceIds: string[]): Promise<void> {
  const response = (await sendRuntimeMessage({
    type: "mcp.session.disclosures.commit",
    sessionId,
    serviceIds
  })) as RuntimeResponse;
  if (!response.ok) throw new Error(response.error);
}

/** 查询当前站点会话是否信任某个 MCP 服务。 */
export async function hasMcpSessionTrust(sessionId: string, serviceId: string): Promise<boolean> {
  const response = (await sendRuntimeMessage({
    type: "mcp.session.trust.get",
    sessionId,
    serviceId
  })) as RuntimeResponse<boolean>;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

/** 保存当前站点会话对某个 MCP 服务的信任。 */
export async function commitMcpSessionTrust(sessionId: string, serviceId: string): Promise<void> {
  const response = (await sendRuntimeMessage({
    type: "mcp.session.trust.commit",
    sessionId,
    serviceId
  })) as RuntimeResponse;
  if (!response.ok) throw new Error(response.error);
}

/** 调用已披露的 MCP Tool，内容脚本只传服务 ID、Tool 名称和 JSON 参数对象。 */
export async function callMcpTool(
  sessionId: string,
  serviceId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolCallResult> {
  const response = (await sendRuntimeMessage({
    type: "mcp.tool.call",
    sessionId,
    serviceId,
    toolName,
    arguments: args
  })) as RuntimeResponse<McpToolCallResult>;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

/** 向扩展 Service Worker 发送一条原始消息，并检测失效的扩展上下文。 */
export async function sendRuntimeMessage(message: unknown): Promise<unknown> {
  if (!chrome.runtime?.id) throw new Error("Extension context invalidated.");
  return await chrome.runtime.sendMessage(message);
}

/** 基于共享扩展运行时消息 API 实现 Tool Call Skill 解析。 */
export class RuntimeSkillProvider implements SkillProvider {
  async listSkills(): Promise<SkillMetadata[]> {
    return loadCatalog();
  }

  async readSkill(skillName: string): Promise<SkillReadResult> {
    return (await loadSkillBatch([skillName]))[0]!;
  }

  async readReference(virtualPath: string): Promise<ReferenceReadResult> {
    const skillName = virtualPath.split("/")[0] ?? "";
    return (await loadReferenceBatch([virtualPath], [skillName]))[0]!;
  }

  async resolveSkill(skillName: string): Promise<SkillReadResult | null> {
    const response = (await sendRuntimeMessage({ type: "skill.resolve", skillName })) as RuntimeResponse<SkillReadResult | null>;
    if (!response.ok) throw new Error(response.error);
    return response.data;
  }

  async resolveReference(virtualPath: string): Promise<ReferenceReadResult | null> {
    const response = (await sendRuntimeMessage({ type: "reference.resolve", virtualPath })) as RuntimeResponse<ReferenceReadResult | null>;
    if (!response.ok) throw new Error(response.error);
    return response.data;
  }
}
