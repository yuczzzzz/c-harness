import { type DBSchema, type IDBPDatabase, openDB } from "idb";

import {
  SKILL_LIMITS,
  type SkillFile,
  type SkillMetadata,
  type SkillPackage,
  type SkillReadResult,
  type ReferenceReadResult
} from "@/skills/contracts";
import { isSafeSkillName, parseReferenceVirtualPath } from "@/skills/paths";

const DATABASE_NAME = "c-harness";
const DATABASE_VERSION = 1;

interface SkillDatabase extends DBSchema {
  skills: {
    key: string;
    value: SkillMetadata;
  };
  skillFiles: {
    key: [string, string];
    value: SkillFile;
    indexes: { bySkill: string };
  };
}

let databasePromise: Promise<IDBPDatabase<SkillDatabase>> | undefined;

/** 打开扩展的版本化 Skill 数据库。 */
export function openSkillDatabase(): Promise<IDBPDatabase<SkillDatabase>> {
  databasePromise ??= openDB<SkillDatabase>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      database.createObjectStore("skills");
      const files = database.createObjectStore("skillFiles", {
        keyPath: ["skillName", "virtualPath"]
      });
      files.createIndex("bySkill", "skillName");
    }
  });
  return databasePromise;
}

/** 返回按稳定 Skill 名称排序的 Skill 目录。 */
export async function listSkills(): Promise<SkillMetadata[]> {
  const database = await openSkillDatabase();
  return (await database.getAll("skills")).sort((left, right) => left.name.localeCompare(right.name));
}

/** 跨元数据和文件存储原子覆盖一个完整的 Skill 包。 */
export async function replaceSkill(skillPackage: SkillPackage): Promise<void> {
  const database = await openSkillDatabase();
  const transaction = database.transaction(["skills", "skillFiles"], "readwrite");
  try {
    // 步骤 1：更改现有记录前执行库容量限制。
    const existing = await transaction.objectStore("skills").get(skillPackage.metadata.name);
    const count = await transaction.objectStore("skills").count();
    if (!existing && count >= SKILL_LIMITS.maxSkills) {
      throw new Error(`Skill 库最多保存 ${SKILL_LIMITS.maxSkills} 个 Skill。`);
    }

    // 步骤 2：在此事务中从两个存储删除旧包。
    let cursor = await transaction
      .objectStore("skillFiles")
      .index("bySkill")
      .openCursor(IDBKeyRange.only(skillPackage.metadata.name));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }

    // 步骤 3：写入完整替代包并作为一个单元提交。
    await transaction.objectStore("skills").put(skillPackage.metadata, skillPackage.metadata.name);
    for (const file of skillPackage.files) {
      await transaction.objectStore("skillFiles").put(file);
    }
    await transaction.done;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // IndexedDB 可能已经中止该事务。
    }
    await transaction.done.catch(() => undefined);
    throw error;
  }
}

/** 原子删除一个完整的 Skill；删除不存在的 Skill 是幂等操作。 */
export async function deleteSkill(skillName: string): Promise<void> {
  const database = await openSkillDatabase();
  const transaction = database.transaction(["skills", "skillFiles"], "readwrite");

  // 步骤 1：删除该 Skill 拥有的所有文本记录。
  let cursor = await transaction
    .objectStore("skillFiles")
    .index("bySkill")
    .openCursor(IDBKeyRange.only(skillName));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }

  // 步骤 2：在同一事务中删除元数据。
  await transaction.objectStore("skills").delete(skillName);
  await transaction.done;
}

/** 按虚拟路径顺序返回一个 Skill 的所有持久化文件。 */
export async function listSkillFiles(skillName: string): Promise<SkillFile[]> {
  const database = await openSkillDatabase();
  const files = await database.getAllFromIndex("skillFiles", "bySkill", skillName);
  return files.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "skill" ? -1 : 1;
    return left.virtualPath.localeCompare(right.virtualPath);
  });
}

/** 校验并返回有序的 SKILL.md 批次，不暴露部分结果。 */
export async function readSkillBatch(skillNames: string[]): Promise<SkillReadResult[]> {
  if (skillNames.length === 0 || new Set(skillNames).size !== skillNames.length) {
    throw new Error("Skill 请求批次无效。");
  }
  const database = await openSkillDatabase();
  const transaction = database.transaction(["skills", "skillFiles"], "readonly");

  // 步骤 1：根据持久化 Skill 目录校验每个请求的名称。
  const metadata = await Promise.all(
    skillNames.map((skillName) => transaction.objectStore("skills").get(skillName))
  );
  if (metadata.some((skill) => !skill)) throw new Error("请求的 Skill 不在当前目录中。");

  // 步骤 2：返回任何内容前，加载并校验完整的有序批次。
  const files = await Promise.all(
    skillNames.map((skillName) => transaction.objectStore("skillFiles").get([skillName, "SKILL.md"]))
  );
  let totalBytes = 0;
  const results = files.map((file, index) => {
    const skillName = skillNames[index]!;
    if (
      !file ||
      file.skillName !== skillName ||
      file.virtualPath !== "SKILL.md" ||
      file.kind !== "skill" ||
      new TextEncoder().encode(file.content).byteLength !== file.byteLength
    ) {
      throw new Error(`Skill「${skillName}」缺少有效的使用说明。`);
    }
    totalBytes += file.byteLength;
    return { skillName, content: file.content, byteLength: file.byteLength };
  });
  if (totalBytes > SKILL_LIMITS.maxTaskBytes) {
    throw new Error(`这批 Skill 内容超过 ${SKILL_LIMITS.maxTaskBytes / 1024} KiB 限制。`);
  }
  await transaction.done;
  return results;
}

/** 校验并返回有序的 Reference，同时执行完整任务的字节预算。 */
export async function readReferenceBatch(
  selectedSkillNames: string[],
  virtualPaths: string[]
): Promise<ReferenceReadResult[]> {
  if (
    selectedSkillNames.length === 0 ||
    selectedSkillNames.some((name) => !isSafeSkillName(name)) ||
    new Set(selectedSkillNames).size !== selectedSkillNames.length ||
    virtualPaths.length === 0 ||
    new Set(virtualPaths).size !== virtualPaths.length
  ) {
    throw new Error("Reference 请求批次无效。");
  }
  const parsedPaths = virtualPaths.map(parseReferenceVirtualPath);
  const selected = new Set(selectedSkillNames);
  if (parsedPaths.some((path) => !path || !selected.has(path.skillName))) {
    throw new Error("Reference 路径不属于当前已选 Skill。");
  }

  const database = await openSkillDatabase();
  const transaction = database.transaction(["skills", "skillFiles"], "readonly");

  // 步骤 1：重新校验每个已选 Skill，并统计其持久化 SKILL.md 的字节数。
  const selectedMetadata = await Promise.all(
    selectedSkillNames.map((skillName) => transaction.objectStore("skills").get(skillName))
  );
  const skillFiles = await Promise.all(
    selectedSkillNames.map((skillName) => transaction.objectStore("skillFiles").get([skillName, "SKILL.md"]))
  );
  if (selectedMetadata.some((metadata) => !metadata)) throw new Error("已选 Skill 不在当前目录中。");
  let totalBytes = 0;
  skillFiles.forEach((file, index) => {
    const skillName = selectedSkillNames[index]!;
    if (!isPersistedFile(file, skillName, "SKILL.md", "skill")) {
      throw new Error(`Skill「${skillName}」缺少有效的使用说明。`);
    }
    totalBytes += file.byteLength;
  });

  // 步骤 2：暴露任何内容前，校验完整的 Reference 批次和总预算。
  const referenceFiles = await Promise.all(parsedPaths.map((path) => {
    const parsed = path!;
    return transaction.objectStore("skillFiles").get([parsed.skillName, parsed.storedPath]);
  }));
  const results = referenceFiles.map((file, index) => {
    const parsed = parsedPaths[index]!;
    const virtualPath = virtualPaths[index]!;
    if (!isPersistedFile(file, parsed.skillName, parsed.storedPath, "reference")) {
      throw new Error(`Reference「${virtualPath}」不存在或无效。`);
    }
    totalBytes += file.byteLength;
    return { virtualPath, content: file.content, byteLength: file.byteLength };
  });
  if (totalBytes > SKILL_LIMITS.maxTaskBytes) {
    throw new Error(`这次任务回注内容超过 ${SKILL_LIMITS.maxTaskBytes / 1024} KiB 限制。`);
  }
  await transaction.done;
  return results;
}

/** 校验渐进式 Reference 批次，仅计算本批次回注内容的预算。 */
export async function readProgressiveReferenceBatch(
  selectedSkillNames: string[],
  virtualPaths: string[]
): Promise<ReferenceReadResult[]> {
  if (
    selectedSkillNames.length === 0 ||
    selectedSkillNames.some((name) => !isSafeSkillName(name)) ||
    new Set(selectedSkillNames).size !== selectedSkillNames.length ||
    virtualPaths.length === 0 ||
    new Set(virtualPaths).size !== virtualPaths.length
  ) throw new Error("Reference 请求批次无效。");
  const parsedPaths = virtualPaths.map(parseReferenceVirtualPath);
  const selected = new Set(selectedSkillNames);
  if (parsedPaths.some((path) => !path || !selected.has(path.skillName))) {
    throw new Error("Reference 路径不属于当前已读 Skill。");
  }

  const database = await openSkillDatabase();
  const transaction = database.transaction(["skills", "skillFiles"], "readonly");

  // 步骤 1：校验每个能力门控 Skill，不将历史内容计入本批次。
  const selectedMetadata = await Promise.all(
    selectedSkillNames.map((skillName) => transaction.objectStore("skills").get(skillName))
  );
  const skillFiles = await Promise.all(
    selectedSkillNames.map((skillName) => transaction.objectStore("skillFiles").get([skillName, "SKILL.md"]))
  );
  if (selectedMetadata.some((metadata) => !metadata)) throw new Error("已读 Skill 不在当前目录中。");
  skillFiles.forEach((file, index) => {
    const skillName = selectedSkillNames[index]!;
    if (!isPersistedFile(file, skillName, "SKILL.md", "skill")) {
      throw new Error(`Skill「${skillName}」缺少有效的使用说明。`);
    }
  });

  // 步骤 2：校验完整请求批次，仅限制实际回注的字节数。
  const referenceFiles = await Promise.all(parsedPaths.map((path) => transaction
    .objectStore("skillFiles").get([path!.skillName, path!.storedPath])));
  let totalBytes = 0;
  const results = referenceFiles.map((file, index) => {
    const parsed = parsedPaths[index]!;
    const virtualPath = virtualPaths[index]!;
    if (!isPersistedFile(file, parsed.skillName, parsed.storedPath, "reference")) {
      throw new Error(`Reference「${virtualPath}」不存在或无效。`);
    }
    totalBytes += file.byteLength;
    return { virtualPath, content: file.content, byteLength: file.byteLength };
  });
  if (totalBytes > SKILL_LIMITS.maxTaskBytes) {
    throw new Error(`这批 Reference 内容超过 ${SKILL_LIMITS.maxTaskBytes / 1024} KiB 限制。`);
  }
  await transaction.done;
  return results;
}

/** 解析当前有效的 SKILL.md，仅在资源不存在或无效时返回 null。 */
export async function resolveStoredSkill(skillName: string): Promise<SkillReadResult | null> {
  if (!isSafeSkillName(skillName)) return null;
  const database = await openSkillDatabase();
  const transaction = database.transaction(["skills", "skillFiles"], "readonly");
  const [metadata, file] = await Promise.all([
    transaction.objectStore("skills").get(skillName),
    transaction.objectStore("skillFiles").get([skillName, "SKILL.md"])
  ]);
  await transaction.done;
  if (!metadata || !isPersistedFile(file, skillName, "SKILL.md", "skill")) return null;
  return { skillName, content: file.content, byteLength: file.byteLength };
}

/** 解析当前有效的 Reference，仅在资源不存在或无效时返回 null。 */
export async function resolveStoredReference(virtualPath: string): Promise<ReferenceReadResult | null> {
  const parsed = parseReferenceVirtualPath(virtualPath);
  if (!parsed) return null;
  const database = await openSkillDatabase();
  const transaction = database.transaction(["skills", "skillFiles"], "readonly");
  const [metadata, file] = await Promise.all([
    transaction.objectStore("skills").get(parsed.skillName),
    transaction.objectStore("skillFiles").get([parsed.skillName, parsed.storedPath])
  ]);
  await transaction.done;
  if (!metadata || !isPersistedFile(file, parsed.skillName, parsed.storedPath, "reference")) return null;
  return { virtualPath, content: file.content, byteLength: file.byteLength };
}

function isPersistedFile(
  file: SkillFile | undefined,
  skillName: string,
  virtualPath: string,
  kind: SkillFile["kind"]
): file is SkillFile {
  return Boolean(
    file &&
    file.skillName === skillName &&
    file.virtualPath === virtualPath &&
    file.kind === kind &&
    new TextEncoder().encode(file.content).byteLength === file.byteLength
  );
}

/** 关闭并清除数据库连接，主要用于确定性测试。 */
export async function resetSkillDatabaseConnection(): Promise<void> {
  const database = await databasePromise;
  database?.close();
  databasePromise = undefined;
}
