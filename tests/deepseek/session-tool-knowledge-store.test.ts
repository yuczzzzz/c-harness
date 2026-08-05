import {
  bindTemporarySessionToolKnowledgeState,
  loadSessionToolKnowledgeState,
  openSessionToolKnowledgeDatabase,
  resetSessionToolKnowledgeDatabaseConnection,
  saveSessionKnowledgeResources
} from "@/deepseek/session-tool-knowledge-store";
import {
  applySessionKnowledgeResources,
  emptySessionToolKnowledgeState,
  sha256Text,
  type SessionKnowledgeResourceResolver
} from "@/deepseek/session-tool-knowledge";

const DATABASE_NAME = "c-harness-deepseek-session-knowledge";

describe("SessionToolKnowledgeStore", () => {
  let skills: Map<string, string>;
  let references: Map<string, string>;
  let resolver: SessionKnowledgeResourceResolver;

  beforeEach(async () => {
    await resetSessionToolKnowledgeDatabaseConnection();
    await deleteDatabase(DATABASE_NAME);
    skills = new Map([["writer", "Skill body"], ["reviewer", "Review body"]]);
    references = new Map([
      ["writer/references/style.md", "Style body"],
      ["reviewer/references/checklist.md", "Checklist body"]
    ]);
    resolver = {
      resolveSkill: async (skillName) => {
        const content = skills.get(skillName);
        return content === undefined ? null : { skillName, content, byteLength: content.length };
      },
      resolveReference: async (virtualPath) => {
        const content = references.get(virtualPath);
        return content === undefined ? null : { virtualPath, content, byteLength: content.length };
      }
    };
  });

  afterEach(async () => {
    await resetSessionToolKnowledgeDatabaseConnection();
  });

  it("isolates sessions and restores the same session after reopening the database", async () => {
    await saveSessionKnowledgeResources("session-a", [{ resourceKind: "skill", resourceId: "writer", contentDigest: await sha256Text("Skill body") }]);
    await saveSessionKnowledgeResources("session-b", [{ resourceKind: "skill", resourceId: "reviewer", contentDigest: await sha256Text("Review body") }]);
    await resetSessionToolKnowledgeDatabaseConnection();

    const sessionA = await loadSessionToolKnowledgeState("session-a", resolver);
    const sessionB = await loadSessionToolKnowledgeState("session-b", resolver);

    expect([...sessionA.skills.keys()]).toEqual(["writer"]);
    expect([...sessionB.skills.keys()]).toEqual(["reviewer"]);
  });

  it("archives temporary state and merges concurrent resource updates", async () => {
    const temporary = emptySessionToolKnowledgeState();
    applySessionKnowledgeResources(temporary, [{ resourceKind: "skill", resourceId: "writer", contentDigest: await sha256Text("Skill body") }]);

    await Promise.all([
      bindTemporarySessionToolKnowledgeState("session-a", temporary),
      saveSessionKnowledgeResources("session-a", [{
        resourceKind: "reference",
        resourceId: "writer/references/style.md",
        contentDigest: await sha256Text("Style body")
      }])
    ]);

    const state = await loadSessionToolKnowledgeState("session-a", resolver);
    expect([...state.skills.keys()]).toEqual(["writer"]);
    expect([...state.references.keys()]).toEqual(["writer/references/style.md"]);
  });

  it("removes only changed, deleted, or damaged entries", async () => {
    await saveSessionKnowledgeResources("session-a", [
      { resourceKind: "skill", resourceId: "writer", contentDigest: await sha256Text("Skill body") },
      { resourceKind: "skill", resourceId: "reviewer", contentDigest: await sha256Text("Review body") },
      { resourceKind: "reference", resourceId: "writer/references/style.md", contentDigest: await sha256Text("Style body") },
      { resourceKind: "reference", resourceId: "reviewer/references/checklist.md", contentDigest: await sha256Text("Checklist body") }
    ]);
    skills.set("writer", "Changed Skill body");
    references.delete("writer/references/style.md");
    const database = await openSessionToolKnowledgeDatabase();
    const damaged = await database.get("resources", ["session-a", "reference", "reviewer/references/checklist.md"]);
    await database.put("resources", { ...damaged!, contentDigest: "damaged" });

    const state = await loadSessionToolKnowledgeState("session-a", resolver);

    expect([...state.skills.keys()]).toEqual(["reviewer"]);
    expect([...state.references.keys()]).toEqual([]);
    expect(await database.count("resources")).toBe(1);
  });

  it("keeps an unchanged Reference independently but does not imply its Skill gate", async () => {
    await saveSessionKnowledgeResources("session-a", [
      { resourceKind: "skill", resourceId: "writer", contentDigest: await sha256Text("Skill body") },
      { resourceKind: "reference", resourceId: "writer/references/style.md", contentDigest: await sha256Text("Style body") }
    ]);
    skills.set("writer", "Changed Skill body");

    const state = await loadSessionToolKnowledgeState("session-a", resolver);

    expect(state.skills.has("writer")).toBe(false);
    expect(state.references.has("writer/references/style.md")).toBe(true);
  });

  it("propagates resolver I/O failures instead of treating them as invalid resources", async () => {
    await saveSessionKnowledgeResources("session-a", [{ resourceKind: "skill", resourceId: "writer", contentDigest: await sha256Text("Skill body") }]);
    resolver.resolveSkill = async () => { throw new Error("IndexedDB unavailable"); };

    await expect(loadSessionToolKnowledgeState("session-a", resolver)).rejects.toThrow("IndexedDB unavailable");
  });

  it("propagates a database open failure", async () => {
    await resetSessionToolKnowledgeDatabaseConnection();
    const originalIndexedDB = indexedDB;
    vi.stubGlobal("indexedDB", {
      open: () => { throw new Error("session database unavailable"); }
    });
    try {
      await expect(loadSessionToolKnowledgeState("session-a", resolver))
        .rejects.toThrow("session database unavailable");
    } finally {
      vi.stubGlobal("indexedDB", originalIndexedDB);
      await resetSessionToolKnowledgeDatabaseConnection().catch(() => undefined);
    }
  });
});

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
