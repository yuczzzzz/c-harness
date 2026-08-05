import { Uint8ArrayReader, ZipReader, type Entry, type FileEntry } from "@zip.js/zip.js";
import { parse } from "yaml";

import {
  SKILL_LIMITS,
  SkillImportError,
  type SkillFile,
  type SkillPackage
} from "@/skills/contracts";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:/u;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_SYMBOLIC_LINK = 0o120000;

interface ArchiveEntry {
  entry: Entry;
  path: string;
}

interface ExtractionBudget {
  totalBytes: number;
}

/**
 * 校验并读取一个 Skill ZIP，生成可供原子持久化的包。
 * ZIP 在本地读取；此函数不会持久化数据，也不会访问网络。
 */
export async function importSkillZip(zipFile: File, importedAt = new Date()): Promise<SkillPackage> {
  const zipBytes = new Uint8Array(await readFile(zipFile));
  const reader = new ZipReader(new Uint8ArrayReader(zipBytes), {
    strictness: "strict",
    checkAmbiguity: true,
    checkOverlappingEntry: true
  });

  try {
    // 步骤 1：解压内容前校验条目元数据和归档路径。
    const entries = await readArchiveEntries(reader);
    const root = resolveArchiveRoot(entries);

    // 步骤 2：在实际输出限制下解压每个常规条目。
    const budget: ExtractionBudget = { totalBytes: 0 };
    const files: SkillFile[] = [];
    let ignoredEntryCount = 0;
    for (const archiveEntry of entries) {
      const entry = archiveEntry.entry;
      if (entry.directory) continue;
      const virtualPath = stripArchiveRoot(archiveEntry.path, root);
      const kind = classifySavedPath(virtualPath);
      const bytes = await extractEntry(entry, budget, Boolean(kind));
      if (!kind) {
        ignoredEntryCount += 1;
        continue;
      }
      if (bytes.byteLength > SKILL_LIMITS.maxTextBytes) {
        throw new SkillImportError(
          "TEXT_TOO_LARGE",
          `${virtualPath} 超过单个保存文本 ${SKILL_LIMITS.maxTextBytes} 字节限制。`
        );
      }
      files.push({
        skillName: "",
        virtualPath,
        kind,
        content: decodeText(bytes, virtualPath),
        byteLength: bytes.byteLength
      });
    }

    // 步骤 3：仅在整个归档通过校验后解析标识。
    const skillFile = files.find((file) => file.virtualPath === "SKILL.md");
    if (!skillFile) {
      throw new SkillImportError("INVALID_LAYOUT", "ZIP 根目录或唯一顶层目录中缺少 SKILL.md。");
    }
    const identity = parseSkillIdentity(skillFile.content);
    for (const file of files) file.skillName = identity.name;

    return {
      metadata: {
        ...identity,
        referenceCount: files.filter((file) => file.kind === "reference").length,
        packageBytes: zipFile.size,
        savedBytes: files.reduce((total, file) => total + file.byteLength, 0),
        ignoredEntryCount,
        importedAt: importedAt.toISOString()
      },
      files
    };
  } catch (error) {
    if (error instanceof SkillImportError) throw error;
    throw new SkillImportError(
      "INVALID_ZIP",
      error instanceof Error ? `ZIP 无法读取：${error.message}` : "ZIP 无法读取。"
    );
  } finally {
    await reader.close().catch(() => undefined);
  }
}

function readFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("ZIP 文件不是二进制数据。"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("ZIP 文件读取失败。"));
    reader.readAsArrayBuffer(file);
  });
}

async function readArchiveEntries(reader: ZipReader<unknown>): Promise<ArchiveEntry[]> {
  const entries = await reader.getEntries();
  if (entries.length > SKILL_LIMITS.maxEntries) {
    throw new SkillImportError(
      "TOO_MANY_ENTRIES",
      `ZIP 条目数超过 ${SKILL_LIMITS.maxEntries} 个限制。`
    );
  }

  const paths = new Set<string>();
  return entries.map((entry) => {
    if (entry.encrypted) {
      throw new SkillImportError("ENCRYPTED_ENTRY", `${entry.filename} 是加密条目。`);
    }
    if (isSymbolicLink(entry)) {
      throw new SkillImportError("SYMLINK_ENTRY", `${entry.filename} 是符号链接。`);
    }
    const path = normalizeArchivePath(entry.filename, entry.directory);
    if (paths.has(path)) {
      throw new SkillImportError("DUPLICATE_PATH", `ZIP 中存在重复规范路径：${path}。`);
    }
    paths.add(path);
    return { entry, path };
  });
}

function normalizeArchivePath(value: string, directory: boolean): string {
  if (
    !value ||
    value.startsWith("/") ||
    WINDOWS_DRIVE_PATTERN.test(value) ||
    value.includes("\\") ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new SkillImportError("INVALID_PATH", `ZIP 路径无效：${value || "<空路径>"}。`);
  }

  const path = directory && value.endsWith("/") ? value.slice(0, -1) : value;
  const segments = path.split("/");
  if (!path || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new SkillImportError("INVALID_PATH", `ZIP 路径无效：${value}。`);
  }
  return segments.join("/");
}

function resolveArchiveRoot(entries: ArchiveEntry[]): string {
  const files = entries.filter(({ entry }) => !entry.directory).map(({ path }) => path);
  if (files.includes("SKILL.md")) return "";

  const roots = new Set(files.map((path) => path.split("/")[0]));
  if (roots.size !== 1) {
    throw new SkillImportError("INVALID_LAYOUT", "SKILL.md 必须位于 ZIP 根目录或唯一顶层目录。 ");
  }
  const root = [...roots][0];
  if (!root || !files.includes(`${root}/SKILL.md`)) {
    throw new SkillImportError("INVALID_LAYOUT", "唯一顶层目录中缺少 SKILL.md。");
  }
  return root;
}

function stripArchiveRoot(path: string, root: string): string {
  return root ? path.slice(root.length + 1) : path;
}

function classifySavedPath(path: string): SkillFile["kind"] | undefined {
  if (path === "SKILL.md") return "skill";
  if (path.startsWith("references/") && path.length > "references/".length) return "reference";
  return undefined;
}

async function extractEntry(
  entry: FileEntry,
  budget: ExtractionBudget,
  retain: boolean
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let retainedBytes = 0;
  let archiveLimitExceeded = false;
  const abortController = new AbortController();
  const writer = new WritableStream<Uint8Array>({
    write(chunk) {
      budget.totalBytes += chunk.byteLength;
      if (budget.totalBytes > SKILL_LIMITS.maxArchiveBytes) {
        archiveLimitExceeded = true;
        abortController.abort();
        return;
      }
      if (retain) {
        retainedBytes += chunk.byteLength;
        chunks.push(chunk.slice());
      }
    }
  });

  try {
    await entry.getData(writer, {
      checkSignature: true,
      checkAmbiguity: true,
      checkOverlappingEntry: true,
      signal: abortController.signal
    });
  } catch (error) {
    if (!archiveLimitExceeded) throw error;
  }
  if (archiveLimitExceeded) {
    throw new SkillImportError(
      "ARCHIVE_TOO_LARGE",
      `ZIP 实际解压内容超过 ${SKILL_LIMITS.maxArchiveBytes} 字节限制。`
    );
  }

  const output = new Uint8Array(retainedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function decodeText(bytes: Uint8Array, path: string): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) {
      throw new Error("contains NUL");
    }
    return text;
  } catch {
    throw new SkillImportError("INVALID_TEXT", `${path} 不是不含 NUL 的严格 UTF-8 文本。`);
  }
}

function parseSkillIdentity(markdown: string): Pick<SkillPackage["metadata"], "name" | "description"> {
  const match = markdown.match(FRONTMATTER_PATTERN);
  if (!match) {
    throw new SkillImportError("INVALID_FRONTMATTER", "SKILL.md 缺少合法 YAML frontmatter。");
  }

  let frontmatter: unknown;
  try {
    frontmatter = parse(match[1]!, { uniqueKeys: true });
  } catch {
    throw new SkillImportError("INVALID_FRONTMATTER", "SKILL.md frontmatter 不是合法 YAML。");
  }
  if (!isRecord(frontmatter)) {
    throw new SkillImportError("INVALID_FRONTMATTER", "SKILL.md frontmatter 必须是键值映射。");
  }

  const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
  const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
  if (
    !name ||
    name === "." ||
    name === ".." ||
    /[\\/]/u.test(name) ||
    CONTROL_CHARACTER_PATTERN.test(name) ||
    !description
  ) {
    throw new SkillImportError(
      "INVALID_FRONTMATTER",
      "frontmatter 必须包含合法 name 和非空 description。"
    );
  }
  return { name, description };
}

function isSymbolicLink(entry: Entry): boolean {
  const unixMode = entry.unixMode ?? entry.externalFileAttributes >>> 16;
  return (unixMode & UNIX_FILE_TYPE_MASK) === UNIX_SYMBOLIC_LINK;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
