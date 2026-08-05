import type { SkillPackage } from "@/skills/contracts";
import {
  deleteSkill,
  listSkillFiles,
  listSkills,
  replaceSkill,
  resetSkillDatabaseConnection
} from "@/skills/store";

const DATABASE_NAME = "c-harness";

describe("Skill store", () => {
  beforeEach(async () => {
    await resetSkillDatabaseConnection();
    await deleteDatabase(DATABASE_NAME);
  });

  afterEach(async () => {
    await resetSkillDatabaseConnection();
  });

  it("replaces and deletes a complete package atomically", async () => {
    await replaceSkill(skillPackage("writer", "old", ["references/old.md"]));
    await replaceSkill(skillPackage("writer", "new", ["references/new.md"]));

    expect(await listSkills()).toEqual([
      expect.objectContaining({ name: "writer", description: "new", referenceCount: 1 })
    ]);
    expect((await listSkillFiles("writer")).map((file) => file.virtualPath)).toEqual([
      "SKILL.md",
      "references/new.md"
    ]);

    await deleteSkill("writer");
    expect(await listSkills()).toEqual([]);
    expect(await listSkillFiles("writer")).toEqual([]);
  });

  it("rolls back removal when replacement data cannot be cloned", async () => {
    const original = skillPackage("writer", "original", ["references/original.md"]);
    await replaceSkill(original);
    const invalid = skillPackage("writer", "invalid", ["references/invalid.md"]);
    invalid.files[1]!.content = (() => undefined) as unknown as string;

    await expect(replaceSkill(invalid)).rejects.toBeDefined();

    expect(await listSkills()).toEqual([expect.objectContaining({ description: "original" })]);
    expect((await listSkillFiles("writer")).map((file) => file.virtualPath)).toContain("references/original.md");
  });
});

function skillPackage(name: string, description: string, references: string[]): SkillPackage {
  const skillContent = `---\nname: ${name}\ndescription: ${description}\n---\n`;
  return {
    metadata: {
      name,
      description,
      referenceCount: references.length,
      packageBytes: 100,
      savedBytes: skillContent.length + references.length * 4,
      ignoredEntryCount: 0,
      importedAt: "2026-07-28T00:00:00.000Z"
    },
    files: [
      { skillName: name, virtualPath: "SKILL.md", kind: "skill", content: skillContent, byteLength: skillContent.length },
      ...references.map((virtualPath) => ({
        skillName: name,
        virtualPath,
        kind: "reference" as const,
        content: "text",
        byteLength: 4
      }))
    ]
  };
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
