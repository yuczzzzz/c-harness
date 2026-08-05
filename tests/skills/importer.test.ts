import { SKILL_LIMITS, SkillImportError } from "@/skills/contracts";
import { importSkillZip } from "@/skills/importer";
import { createDuplicatePathZip, createTestZip, validSkillMarkdown } from "@tests/helpers/zip";

describe("importSkillZip", () => {
  it("imports root layout, references, and reports ignored files", async () => {
    const file = await createTestZip([
      { name: "SKILL.md", content: validSkillMarkdown() },
      { name: "references/checklist.md", content: "check one" },
      { name: "scripts/run.sh", content: "echo no" },
      { name: "assets/logo.png", content: new Uint8Array([0, 1, 2]) }
    ]);

    const result = await importSkillZip(file, new Date("2026-07-28T00:00:00.000Z"));

    expect(result.metadata).toMatchObject({
      name: "eval-design",
      description: "Design reliable evals",
      referenceCount: 1,
      ignoredEntryCount: 2,
      importedAt: "2026-07-28T00:00:00.000Z"
    });
    expect(result.files.map((entry) => entry.virtualPath)).toEqual([
      "SKILL.md",
      "references/checklist.md"
    ]);
    expect(result.files.every((entry) => entry.skillName === "eval-design")).toBe(true);
  });

  it("imports a unique top-level directory layout", async () => {
    const file = await createTestZip([
      { name: "package/SKILL.md", content: validSkillMarkdown("writer", "Write clearly") },
      { name: "package/references/style.md", content: "Be direct." }
    ]);

    const result = await importSkillZip(file);

    expect(result.metadata.name).toBe("writer");
    expect(result.files[1]?.virtualPath).toBe("references/style.md");
  });

  it("imports project-filesystem as a normal Skill name", async () => {
    const file = await createTestZip([
      {
        name: "SKILL.md",
        content: validSkillMarkdown("project-filesystem", "User supplied project filesystem notes")
      }
    ]);

    await expect(importSkillZip(file)).resolves.toMatchObject({
      metadata: {
        name: "project-filesystem",
        description: "User supplied project filesystem notes"
      }
    });
  });

  it.each([
    ["missing frontmatter", "# skill", "INVALID_FRONTMATTER"],
    ["missing description", "---\nname: broken\n---\n", "INVALID_FRONTMATTER"],
    ["invalid name", "---\nname: ../broken\ndescription: no\n---\n", "INVALID_FRONTMATTER"]
  ])("rejects %s", async (_label, markdown, code) => {
    const file = await createTestZip([{ name: "SKILL.md", content: markdown }]);

    await expect(importSkillZip(file)).rejects.toMatchObject({ code });
  });

  it("rejects encrypted entries before reading content", async () => {
    const file = await createTestZip([
      { name: "SKILL.md", content: validSkillMarkdown(), options: { password: "secret" } }
    ]);

    await expect(importSkillZip(file)).rejects.toMatchObject({ code: "ENCRYPTED_ENTRY" });
  });

  it.each(["../SKILL.md", "/SKILL.md", "folder\\SKILL.md"])("rejects unsafe path %s", async (name) => {
    const file = await createTestZip([{ name, content: validSkillMarkdown() }]);

    await expect(importSkillZip(file)).rejects.toMatchObject({ code: "INVALID_PATH" });
  });

  it("rejects duplicate normalized paths", async () => {
    const file = await createDuplicatePathZip();

    await expect(importSkillZip(file)).rejects.toMatchObject({ code: "INVALID_ZIP" });
  });

  it("rejects symbolic links from Unix entry metadata", async () => {
    const file = await createTestZip([
      { name: "SKILL.md", content: validSkillMarkdown() },
      { name: "references/link.md", content: "target", options: { unixMode: 0o120777 } }
    ]);

    await expect(importSkillZip(file)).rejects.toMatchObject({ code: "SYMLINK_ENTRY" });
  });

  it.each([
    [new Uint8Array([0xff, 0xfe]), "invalid UTF-8"],
    [new TextEncoder().encode(`${validSkillMarkdown()}\0`), "NUL"]
  ])("rejects saved text containing %s", async (content) => {
    const file = await createTestZip([{ name: "SKILL.md", content }]);

    await expect(importSkillZip(file)).rejects.toMatchObject({ code: "INVALID_TEXT" });
  });

  it("rejects a saved text over the per-file limit", async () => {
    const content = `${validSkillMarkdown()}${"x".repeat(SKILL_LIMITS.maxTextBytes)}`;
    const file = await createTestZip([{ name: "SKILL.md", content }]);

    await expect(importSkillZip(file)).rejects.toMatchObject({ code: "TEXT_TOO_LARGE" });
  });

  it("counts actual decompressed bytes for ignored entries", async () => {
    const file = await createTestZip([
      { name: "SKILL.md", content: validSkillMarkdown() },
      { name: "assets/large.bin", content: new Uint8Array(SKILL_LIMITS.maxArchiveBytes) }
    ]);

    await expect(importSkillZip(file)).rejects.toMatchObject({ code: "ARCHIVE_TOO_LARGE" });
  });

  it("rejects more than the allowed entry count", async () => {
    const entries = [{ name: "SKILL.md", content: validSkillMarkdown() }];
    for (let index = 0; index < SKILL_LIMITS.maxEntries; index += 1) {
      entries.push({ name: `ignored/${index}.txt`, content: "" });
    }
    const file = await createTestZip(entries);

    await expect(importSkillZip(file)).rejects.toMatchObject({ code: "TOO_MANY_ENTRIES" });
  });

  it("rejects corrupt ZIP input with a stable error", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "broken.zip");

    await expect(importSkillZip(file)).rejects.toEqual(expect.objectContaining<Partial<SkillImportError>>({
      code: "INVALID_ZIP"
    }));
  });
});
