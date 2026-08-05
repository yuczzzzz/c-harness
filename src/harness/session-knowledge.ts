import type { SessionToolKnowledgeState } from "@/session-knowledge/state";

/** 格式化当前 DeepSeek 会话中已读取有效资源的精简模型可见列表。 */
export function formatSessionKnowledgeState(state: SessionToolKnowledgeState): string {
  const skills = Array.from(state.skills.keys()).sort((left, right) => left.localeCompare(right));
  const references = Array.from(state.references.keys()).sort((left, right) => left.localeCompare(right));
  if (skills.length === 0 && references.length === 0) {
    return "本会话已经读取：\n- Skill：（尚未读取）\n- Reference：（尚未读取）";
  }
  return [
    "本会话已经读取：",
    `- Skill：${skills.length > 0 ? skills.join("、") : "（尚未读取）"}`,
    `- Reference：${references.length > 0 ? references.join("、") : "（尚未读取）"}`,
    "",
    "这些内容无需重新读取；可以直接使用其已披露能力。需要重新获取正文时，仍可再次显式读取。"
  ].join("\n");
}
