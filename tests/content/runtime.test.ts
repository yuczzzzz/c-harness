import { installSiteContentRuntime } from "@/content/runtime";
import { emptySessionToolKnowledgeState, type SessionKnowledgeResource, type SessionKnowledgeResourceResolver, type SessionToolKnowledgeState } from "@/session-knowledge/state";
import type { SessionToolKnowledgeStore } from "@/session-knowledge/store";
import type { SiteTaskPort } from "@/tasks/page-task-coordinator";

describe("shared content runtime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads existing session knowledge and keeps MCP disclosure support", async () => {
    const requests: unknown[] = [];
    stubRuntime(requests);
    const knowledgeStore = new FakeKnowledgeStore(emptySessionToolKnowledgeState());
    const adapter = new RuntimeAdapter(["Final answer"], "session-1");
    const coordinator = installSiteContentRuntime(adapter, knowledgeStore, document);

    await coordinator.startQuestion("Question");

    expect(knowledgeStore.loadedSessions).toEqual(["session-1"]);
    expect(requests).toEqual([
      { type: "settings.get" },
      { type: "catalog.get" },
      { type: "mcp.serviceCatalog.get" },
      { type: "mcp.session.disclosures.get", sessionId: "session-1" }
    ]);
    coordinator.dispose();
  });

  it("binds a new conversation session and uses progressive Reference reads", async () => {
    const requests: unknown[] = [];
    stubRuntime(requests);
    const knowledgeStore = new FakeKnowledgeStore(emptySessionToolKnowledgeState());
    const adapter = new RuntimeAdapter([
      "```skill\nname: writer\n```",
      "```read\npath: writer/references/a.md\n```",
      "Final answer"
    ]);
    const coordinator = installSiteContentRuntime(adapter, knowledgeStore, document);

    await coordinator.startQuestion("Question");

    expect(knowledgeStore.boundSessions).toEqual(["opened-session"]);
    expect(knowledgeStore.savedResources.map((entry) => entry.resources.map((resource) => resource.resourceId))).toEqual([
      ["writer"],
      ["writer/references/a.md"]
    ]);
    expect(requests).toEqual([
      { type: "settings.get" },
      { type: "catalog.get" },
      { type: "mcp.serviceCatalog.get" },
      { type: "skill.readBatch", skillNames: ["writer"] },
      { type: "settings.get" },
      {
        type: "reference.readProgressiveBatch",
        selectedSkillNames: ["writer"],
        virtualPaths: ["writer/references/a.md"]
      },
      { type: "settings.get" }
    ]);
    coordinator.dispose();
  });
});

function stubRuntime(requests: unknown[]): void {
  vi.stubGlobal("chrome", {
    runtime: {
      id: "test-extension",
      sendMessage: vi.fn(async (request: { type: string }) => {
        requests.push(request);
        if (request.type === "settings.get") {
          return {
            ok: true,
            data: { skillEnabled: true, reinjectionDelayMinSeconds: 0, reinjectionDelayMaxSeconds: 0 }
          };
        }
        if (request.type === "catalog.get") {
          return {
            ok: true,
            data: [{
              name: "writer",
              description: "Write",
              referenceCount: 1,
              packageBytes: 100,
              savedBytes: 80,
              ignoredEntryCount: 0,
              importedAt: "2026-08-07T00:00:00.000Z"
            }]
          };
        }
        if (request.type === "mcp.serviceCatalog.get") {
          return {
            ok: true,
            data: [{
              serviceId: "weather",
              displayName: "Weather Tools",
              description: "天气查询",
              toolCount: 1
            }]
          };
        }
        if (request.type === "mcp.session.disclosures.get") return { ok: true, data: [] };
        if (request.type === "skill.readBatch") {
          return { ok: true, data: [{ skillName: "writer", content: "body", byteLength: 4 }] };
        }
        if (request.type === "reference.readProgressiveBatch") {
          return { ok: true, data: [{ virtualPath: "writer/references/a.md", content: "alpha", byteLength: 5 }] };
        }
        if (request.type === "skill.resolve") return { ok: true, data: null };
        if (request.type === "reference.resolve") return { ok: true, data: null };
        return { ok: true, data: [] };
      })
    }
  });
}

class RuntimeAdapter implements SiteTaskPort {
  readonly siteName = "Test";
  private cursor: object = {};
  private sentCount = 0;

  constructor(
    private readonly answers: string[],
    private sessionId: string | null = null
  ) {}

  readComposer(): string | null { return null; }
  isComposerTarget(): boolean { return false; }
  isSendControl(): boolean { return false; }
  isStopControl(): boolean { return false; }
  isConversationNavigation(): boolean { return false; }
  getCurrentSessionId(): string | null { return this.sessionId; }
  captureAssistantCursor(): object | null { return this.cursor; }
  sendMessage(): void {
    this.sentCount += 1;
    if (this.sentCount === 1 && !this.sessionId) this.sessionId = "opened-session";
  }
  waitForAssistantAnswer(): Promise<string> {
    this.cursor = {};
    return Promise.resolve(this.answers.shift() ?? "Final answer");
  }
  showStatus(): void {}
  dispose(): void {}
}

class FakeKnowledgeStore implements SessionToolKnowledgeStore {
  readonly loadedSessions: string[] = [];
  readonly boundSessions: string[] = [];
  readonly savedResources: Array<{ sessionId: string; resources: SessionKnowledgeResource[] }> = [];

  constructor(private readonly state: SessionToolKnowledgeState) {}

  async loadSessionToolKnowledgeState(
    sessionId: string,
    _resolver: SessionKnowledgeResourceResolver
  ): Promise<SessionToolKnowledgeState> {
    this.loadedSessions.push(sessionId);
    return this.state;
  }

  async saveSessionKnowledgeResources(sessionId: string, resources: SessionKnowledgeResource[]): Promise<void> {
    this.savedResources.push({ sessionId, resources });
  }

  async bindTemporarySessionToolKnowledgeState(sessionId: string): Promise<void> {
    this.boundSessions.push(sessionId);
  }
}
