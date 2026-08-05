import type { ReferenceReadResult, SkillMetadata, SkillReadResult } from "@/skills/contracts";
import {
  listSkills,
  readReferenceBatch,
  readSkillBatch,
  resolveStoredReference,
  resolveStoredSkill
} from "@/skills/store";

export interface SkillProvider {
  listSkills(): Promise<SkillMetadata[]>;
  readSkill(skillName: string): Promise<SkillReadResult>;
  readReference(virtualPath: string): Promise<ReferenceReadResult>;
  resolveSkill(skillName: string): Promise<SkillReadResult | null>;
  resolveReference(virtualPath: string): Promise<ReferenceReadResult | null>;
}

/** 将现有 IndexedDB Skill Store 适配到单项 Tool Call SkillProvider 边界。 */
export class StoreSkillProvider implements SkillProvider {
  async listSkills(): Promise<SkillMetadata[]> {
    return listSkills();
  }

  async readSkill(skillName: string): Promise<SkillReadResult> {
    return (await readSkillBatch([skillName]))[0]!;
  }

  async readReference(virtualPath: string): Promise<ReferenceReadResult> {
    const skillName = virtualPath.split("/")[0] ?? "";
    return (await readReferenceBatch([skillName], [virtualPath]))[0]!;
  }

  async resolveSkill(skillName: string): Promise<SkillReadResult | null> {
    return await resolveStoredSkill(skillName);
  }

  async resolveReference(virtualPath: string): Promise<ReferenceReadResult | null> {
    return await resolveStoredReference(virtualPath);
  }
}

export interface FixtureSkill {
  metadata: SkillMetadata;
  skillContent: string;
  references?: Record<string, string>;
}

/** 用于确定性 CLI 评估的内存 SkillProvider，不写入产品 IndexedDB。 */
export class FixtureSkillProvider implements SkillProvider {
  private readonly skills: Map<string, FixtureSkill>;

  constructor(fixtures: FixtureSkill[]) {
    this.skills = new Map(fixtures.map((fixture) => [fixture.metadata.name, fixture]));
  }

  async listSkills(): Promise<SkillMetadata[]> {
    return Array.from(this.skills.values()).map((fixture) => fixture.metadata).sort((left, right) => left.name.localeCompare(right.name));
  }

  async readSkill(skillName: string): Promise<SkillReadResult> {
    const fixture = this.skills.get(skillName);
    if (!fixture) throw new Error("请求的 Skill 不在当前目录中。");
    return { skillName, content: fixture.skillContent, byteLength: byteLength(fixture.skillContent) };
  }

  async readReference(virtualPath: string): Promise<ReferenceReadResult> {
    const [skillName] = virtualPath.split("/");
    const fixture = skillName ? this.skills.get(skillName) : undefined;
    const content = fixture?.references?.[virtualPath];
    if (!content) throw new Error(`Reference「${virtualPath}」不存在或无效。`);
    return { virtualPath, content, byteLength: byteLength(content) };
  }

  async resolveSkill(skillName: string): Promise<SkillReadResult | null> {
    const fixture = this.skills.get(skillName);
    return fixture
      ? { skillName, content: fixture.skillContent, byteLength: byteLength(fixture.skillContent) }
      : null;
  }

  async resolveReference(virtualPath: string): Promise<ReferenceReadResult | null> {
    const [skillName] = virtualPath.split("/");
    const content = skillName ? this.skills.get(skillName)?.references?.[virtualPath] : undefined;
    return content === undefined ? null : { virtualPath, content, byteLength: byteLength(content) };
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
