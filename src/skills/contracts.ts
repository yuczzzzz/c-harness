export const SKILL_LIMITS = {
  maxSkills: 50,
  maxEntries: 500,
  maxArchiveBytes: 5 * 1024 * 1024,
  maxTextBytes: 512 * 1024,
  maxTaskBytes: 200 * 1024
} as const;

/** 显示在 Skill 库中并包含在面向模型目录中的元数据。 */
export interface SkillMetadata {
  name: string;
  description: string;
  referenceCount: number;
  packageBytes: number;
  savedBytes: number;
  ignoredEntryCount: number;
  importedAt: string;
}

/** 属于一个已导入 Skill 的持久化文本文件。 */
export interface SkillFile {
  skillName: string;
  virtualPath: string;
  kind: "skill" | "reference";
  content: string;
  byteLength: number;
}

/** 已完整校验、可供原子存储事务使用的 Skill 包。 */
export interface SkillPackage {
  metadata: SkillMetadata;
  files: SkillFile[];
}

/** 作为有序原子读取批次一部分返回的一份已校验 SKILL.md。 */
export interface SkillReadResult {
  skillName: string;
  content: string;
  byteLength: number;
}

/** 作为有序原子读取批次一部分返回的一份已校验 Reference。 */
export interface ReferenceReadResult {
  virtualPath: string;
  content: string;
  byteLength: number;
}

export type SkillImportErrorCode =
  | "INVALID_ZIP"
  | "TOO_MANY_ENTRIES"
  | "ARCHIVE_TOO_LARGE"
  | "INVALID_PATH"
  | "DUPLICATE_PATH"
  | "ENCRYPTED_ENTRY"
  | "SYMLINK_ENTRY"
  | "INVALID_LAYOUT"
  | "INVALID_TEXT"
  | "TEXT_TOO_LARGE"
  | "INVALID_FRONTMATTER";

/** 适用于管理页面反馈和测试的稳定导入错误。 */
export class SkillImportError extends Error {
  constructor(
    public readonly code: SkillImportErrorCode,
    message: string
  ) {
    super(message);
    this.name = "SkillImportError";
  }
}
