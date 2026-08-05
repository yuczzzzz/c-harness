import type { ReferenceReadResult, SkillReadResult } from "@/skills/contracts";

export type SessionKnowledgeResourceKind = "skill" | "reference";

export interface SessionKnowledgeResource {
  resourceKind: SessionKnowledgeResourceKind;
  resourceId: string;
  contentDigest: string;
}

export interface SessionKnowledgeResourceRecord extends SessionKnowledgeResource {
  sessionId: string;
  updatedAt: string;
}

export interface SessionToolKnowledgeState {
  skills: Map<string, string>;
  references: Map<string, string>;
}

export interface SessionKnowledgeResourceResolver {
  resolveSkill(skillName: string): Promise<SkillReadResult | null>;
  resolveReference(virtualPath: string): Promise<ReferenceReadResult | null>;
}

/** 创建隔离的空会话知识状态。 */
export function emptySessionToolKnowledgeState(): SessionToolKnowledgeState {
  return { skills: new Map(), references: new Map() };
}

/** 返回适用于单个任务可变能力门控的深拷贝。 */
export function cloneSessionToolKnowledgeState(state: SessionToolKnowledgeState): SessionToolKnowledgeState {
  return { skills: new Map(state.skills), references: new Map(state.references) };
}

/** 计算原始 UTF-8 文本的小写十六进制 SHA-256 摘要。 */
export async function sha256Text(content: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 将成功的模型可见 Skill 读取转换为可持久化的摘要资源。 */
export async function digestSkillReads(results: SkillReadResult[]): Promise<SessionKnowledgeResource[]> {
  return await Promise.all(results.map(async (result) => ({
    resourceKind: "skill" as const,
    resourceId: result.skillName,
    contentDigest: await sha256Text(result.content)
  })));
}

/** 将成功的模型可见 Reference 读取转换为可持久化的摘要资源。 */
export async function digestReferenceReads(results: ReferenceReadResult[]): Promise<SessionKnowledgeResource[]> {
  return await Promise.all(results.map(async (result) => ({
    resourceKind: "reference" as const,
    resourceId: result.virtualPath,
    contentDigest: await sha256Text(result.content)
  })));
}

/** 将资源级更新应用到一个内存任务或会话状态。 */
export function applySessionKnowledgeResources(
  state: SessionToolKnowledgeState,
  resources: SessionKnowledgeResource[]
): void {
  for (const resource of resources) {
    const target = resource.resourceKind === "skill" ? state.skills : state.references;
    target.set(resource.resourceId, resource.contentDigest);
  }
}
