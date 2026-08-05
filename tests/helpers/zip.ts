import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter, type ZipWriterAddDataOptions } from "@zip.js/zip.js";

interface TestZipEntry {
  name: string;
  content?: string | Uint8Array;
  options?: ZipWriterAddDataOptions;
}

/** 为导入器和 UI 测试创建内存中的 ZIP 文件。 */
export async function createTestZip(entries: TestZipEntry[], fileName = "skill.zip"): Promise<File> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const entry of entries) {
    const content = typeof entry.content === "string"
      ? new TextEncoder().encode(entry.content)
      : entry.content ?? new Uint8Array();
    const reader = new Uint8ArrayReader(content);
    await writer.add(entry.name, reader, entry.options);
  }
  const bytes = await writer.close();
  return new File([bytes], fileName, { type: "application/zip" });
}

/** 创建一个中央目录头和本地文件头中包含重复文件名的 ZIP。 */
export async function createDuplicatePathZip(): Promise<File> {
  const file = await createTestZip([
    { name: "SKILL.md", content: validSkillMarkdown() },
    { name: "references/a1.md", content: "one" },
    { name: "references/a2.md", content: "two" }
  ]);
  const bytes = new Uint8Array(await readFile(file));
  replaceAll(bytes, new TextEncoder().encode("references/a2.md"), new TextEncoder().encode("references/a1.md"));
  return new File([bytes], "duplicate.zip", { type: "application/zip" });
}

/** 返回最小的有效 SKILL.md 正文。 */
export function validSkillMarkdown(name = "eval-design", description = "Design reliable evals"): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
}

function replaceAll(bytes: Uint8Array, source: Uint8Array, replacement: Uint8Array): void {
  for (let index = 0; index <= bytes.length - source.length; index += 1) {
    if (source.every((value, offset) => bytes[index + offset] === value)) {
      bytes.set(replacement, index);
      index += source.length - 1;
    }
  }
}

function readFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error("Not binary"));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
