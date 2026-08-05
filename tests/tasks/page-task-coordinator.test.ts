import type { SiteTaskPort } from "@/tasks/page-task-coordinator";
import { PageTaskCoordinator } from "@/tasks/page-task-coordinator";
import { emptySessionToolKnowledgeState } from "@/deepseek/session-tool-knowledge";

describe("PageTaskCoordinator", () => {
  beforeEach(() => {
    document.body.innerHTML = '<textarea name="search"></textarea><div id="send"></div><a id="conversation"></a>';
  });

  it("intercepts Enter and sends one visible enhanced message", async () => {
    const adapter = new FakeAdapter();
    adapter.question = "  原始问题  ";
    const loadCatalog = vi.fn().mockResolvedValue([]);
    const coordinator = new PageTaskCoordinator(adapter, loadCatalog, vi.fn(), vi.fn(), document);
    coordinator.install();

    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    adapter.composer.dispatchEvent(event);

    await vi.waitFor(() => expect(coordinator.currentState).toBe("completed"));
    expect(event.defaultPrevented).toBe(true);
    expect(loadCatalog).toHaveBeenCalledOnce();
    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0]).toContain("原始问题");
    expect(adapter.sentMessages[0]).toContain("（当前没有已导入的 Skill）");
    expect(adapter.waitedFromCursor).not.toBeNull();
  });

  it("does not turn its own real send-control click into another task", async () => {
    const adapter = new FakeAdapter();
    adapter.question = "问题";
    adapter.clickDuringSend = true;
    const loadCatalog = vi.fn().mockResolvedValue([]);
    const coordinator = new PageTaskCoordinator(adapter, loadCatalog, vi.fn(), vi.fn(), document);
    coordinator.install();

    adapter.sendControl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(coordinator.currentState).toBe("completed"));
    expect(loadCatalog).toHaveBeenCalledOnce();
    expect(adapter.sentMessages).toHaveLength(1);
  });

  it("allows custom runtime messages to use the same internal send guard", async () => {
    const adapter = new FakeAdapter();
    adapter.question = "人工问题";
    adapter.clickDuringSend = true;
    const loadCatalog = vi.fn().mockResolvedValue([]);
    const coordinator = new PageTaskCoordinator(adapter, loadCatalog, vi.fn(), vi.fn(), document);
    coordinator.install();

    await coordinator.sendInternalMessage("运行时 Harness");

    expect(adapter.sentMessages).toEqual(["运行时 Harness"]);
    expect(loadCatalog).not.toHaveBeenCalled();
  });

  it("awaits pass-through sends so async native failures are reported", async () => {
    const adapter = new FakeAdapter();
    adapter.question = "原始问题";
    adapter.sendError = new Error("原生发送失败。");
    adapter.asyncSend = true;
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      document,
      {
        shouldInterceptQuestion: async () => false
      }
    );
    coordinator.install();

    adapter.sendControl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(adapter.statuses.at(-1)).toEqual(["增强失败：原生发送失败。", "error"]));
    expect(adapter.sendAttempts).toBe(1);
  });

  it("does not re-intercept the native send click during pass-through", async () => {
    const adapter = new FakeAdapter();
    adapter.question = "原始问题";
    adapter.clickDuringSend = true;
    const shouldInterceptQuestion = vi.fn().mockResolvedValue(false);
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      document,
      { shouldInterceptQuestion }
    );
    coordinator.install();

    adapter.sendControl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(adapter.sentMessages).toEqual(["原始问题"]));
    expect(adapter.sendAttempts).toBe(1);
    expect(shouldInterceptQuestion).toHaveBeenCalledOnce();
  });

  it("notifies custom runtime when the native stop control is clicked", () => {
    const adapter = new FakeAdapter();
    adapter.stopMode = true;
    adapter.question = "原始问题";
    const onStopControlClick = vi.fn();
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      document,
      { isCustomTaskActive: () => true, onStopControlClick }
    );
    coordinator.install();

    adapter.sendControl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(onStopControlClick).toHaveBeenCalledOnce();
    expect(adapter.sentMessages).toHaveLength(0);
  });

  it("treats the enabled native control as send while no task is active", async () => {
    const adapter = new FakeAdapter();
    adapter.stopMode = true;
    adapter.question = "原始问题";
    const onStopControlClick = vi.fn();
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn().mockResolvedValue([]),
      vi.fn(),
      vi.fn(),
      document,
      { isCustomTaskActive: () => false, onStopControlClick }
    );
    coordinator.install();

    adapter.sendControl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(adapter.sentMessages).toHaveLength(1));
    expect(onStopControlClick).not.toHaveBeenCalled();
  });

  it("notifies custom runtime when conversation navigation starts", () => {
    const adapter = new FakeAdapter();
    adapter.conversationNavigation = true;
    const onConversationNavigation = vi.fn();
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      document,
      { onConversationNavigation }
    );
    coordinator.install();

    adapter.conversationLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(onConversationNavigation).toHaveBeenCalledOnce();
  });

  it("blocks a second human send while a task is active", async () => {
    const adapter = new FakeAdapter();
    let resolveCatalog!: () => void;
    const catalogPending = new Promise<void>((resolve) => { resolveCatalog = resolve; });
    const loadCatalog = vi.fn(async () => {
      await catalogPending;
      return [];
    });
    const coordinator = new PageTaskCoordinator(adapter, loadCatalog, vi.fn(), vi.fn(), document);

    const first = coordinator.startQuestion("第一个问题");
    await coordinator.startQuestion("第二个问题");

    expect(adapter.statuses.at(-1)).toEqual(["当前增强任务尚未结束。", "error"]);
    expect(loadCatalog).toHaveBeenCalledOnce();
    resolveCatalog();
    await first;
  });

  it("cancels an active task when the content runtime is disposed", async () => {
    const adapter = new FakeAdapter();
    const coordinator = new PageTaskCoordinator(adapter, () => new Promise(() => {}), vi.fn(), vi.fn(), document);

    void coordinator.startQuestion("问题");
    coordinator.dispose();

    expect(coordinator.currentState).toBe("cancelled");
    expect(adapter.disposed).toBe(true);
  });

  it("reads and reinjects multiple requested Skills before accepting a final answer", async () => {
    const adapter = new FakeAdapter();
    let resolveFinalAnswer!: (answer: string) => void;
    const finalAnswer = new Promise<string>((resolve) => { resolveFinalAnswer = resolve; });
    adapter.answers = [
      "```skill\nname: writer\n```\n```skill\nname: eval-design\n```",
      finalAnswer
    ];
    const readSkillBatch = vi.fn().mockResolvedValue([
      { skillName: "writer", content: "writer body", byteLength: 11 },
      { skillName: "eval-design", content: "eval body", byteLength: 9 }
    ]);
    const coordinator = new PageTaskCoordinator(adapter, vi.fn().mockResolvedValue([]), readSkillBatch, vi.fn(), document);

    const task = coordinator.startQuestion("问题");

    await vi.waitFor(() => expect(coordinator.currentState).toBe("awaiting_reference_selection"));

    expect(readSkillBatch).toHaveBeenCalledWith(["writer", "eval-design"]);
    expect(adapter.sentMessages).toHaveLength(2);
    expect(adapter.sentMessages[1]).toContain("我把你需要的 Skill 使用说明都放在下面了：");
    expect(adapter.sentMessages[1]).toContain("1. Skill：writer");
    expect(adapter.sentMessages[1]).toContain("2. Skill：eval-design");
    resolveFinalAnswer("这是使用 Skill 后的最终回答。");
    await task;
    expect(coordinator.currentState).toBe("completed");
  });

  it("reads multiple References and then accepts only a command-free final answer", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = [
      "```skill\nname: writer\n```",
      "```read\npath: writer/references/a.md\n```\n```read\npath: writer/references/b.md\n```",
      "最终回答"
    ];
    const readSkillBatch = vi.fn().mockResolvedValue([
      { skillName: "writer", content: "skill body", byteLength: 10 }
    ]);
    const readReferenceBatch = vi.fn().mockResolvedValue([
      { virtualPath: "writer/references/a.md", content: "alpha", byteLength: 5 },
      { virtualPath: "writer/references/b.md", content: "beta", byteLength: 4 }
    ]);
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn().mockResolvedValue([]),
      readSkillBatch,
      readReferenceBatch,
      document
    );

    await coordinator.startQuestion("问题");

    expect(readReferenceBatch).toHaveBeenCalledWith(
      ["writer/references/a.md", "writer/references/b.md"],
      ["writer"]
    );
    expect(adapter.sentMessages[2]).toContain("我把你需要的参考资料都放在下面了：");
    expect(coordinator.currentState).toBe("completed");
  });

  it("does not execute a reading command after Reference content is injected", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = [
      "```skill\nname: writer\n```",
      "```read\npath: writer/references/a.md\n```",
      "```read\npath: writer/references/b.md\n```",
      "```read\npath: writer/references/b.md\n```"
    ];
    const readSkillBatch = vi.fn().mockResolvedValue([
      { skillName: "writer", content: "skill body", byteLength: 10 }
    ]);
    const readReferenceBatch = vi.fn().mockResolvedValue([
      { virtualPath: "writer/references/a.md", content: "alpha", byteLength: 5 }
    ]);
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn().mockResolvedValue([]),
      readSkillBatch,
      readReferenceBatch,
      document
    );

    await coordinator.startQuestion("问题");

    expect(readReferenceBatch).toHaveBeenCalledOnce();
    expect(coordinator.currentState).toBe("failed");
  });

  it("rejects a read command during Skill selection without reading anything", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = [
      "```read\npath: writer/references/a.md\n```",
      "```read\npath: writer/references/a.md\n```"
    ];
    const readSkillBatch = vi.fn();
    const readReferenceBatch = vi.fn();
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn().mockResolvedValue([]),
      readSkillBatch,
      readReferenceBatch,
      document
    );

    await coordinator.startQuestion("问题");

    expect(readSkillBatch).not.toHaveBeenCalled();
    expect(readReferenceBatch).not.toHaveBeenCalled();
    expect(coordinator.currentState).toBe("failed");
  });

  it("corrects one invalid Skill batch and accepts the retry", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = [
      "```skill\nname: missing\n```",
      "```skill\nname: writer\n```",
      "最终回答"
    ];
    const readSkillBatch = vi.fn()
      .mockRejectedValueOnce(new Error("请求的 Skill 不在当前目录中。"))
      .mockResolvedValueOnce([{ skillName: "writer", content: "body", byteLength: 4 }]);
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn().mockResolvedValue([]),
      readSkillBatch,
      vi.fn(),
      document
    );

    await coordinator.startQuestion("问题");

    expect(readSkillBatch).toHaveBeenCalledTimes(2);
    expect(adapter.sentMessages[1]).toContain("这批 skill 请求的写法不对，我没有读取。");
    expect(adapter.sentMessages[2]).toContain("我把你需要的 Skill 使用说明都放在下面了：");
    expect(coordinator.currentState).toBe("completed");
  });

  it("fails after two invalid Skill batches and sends only one correction", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = ["```read\npath: writer/references/a.md\n```", "```read\npath: writer/references/a.md\n```"];
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn().mockResolvedValue([]),
      vi.fn(),
      vi.fn(),
      document
    );

    await coordinator.startQuestion("问题");

    expect(adapter.sentMessages.filter((message) => message.includes("这批 skill 请求的写法不对"))).toHaveLength(1);
    expect(coordinator.currentState).toBe("failed");
  });

  it("keeps Skill and Reference correction opportunities independent", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = [
      "```skill\nname: missing\n```",
      "```skill\nname: writer\n```",
      "```read\npath: writer/references/missing.md\n```",
      "```read\npath: writer/references/a.md\n```",
      "最终回答"
    ];
    const readSkillBatch = vi.fn()
      .mockRejectedValueOnce(new Error("请求的 Skill 不在当前目录中。"))
      .mockResolvedValueOnce([{ skillName: "writer", content: "body", byteLength: 4 }]);
    const readReferenceBatch = vi.fn()
      .mockRejectedValueOnce(new Error("Reference 不存在。"))
      .mockResolvedValueOnce([{ virtualPath: "writer/references/a.md", content: "alpha", byteLength: 5 }]);
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn().mockResolvedValue([]),
      readSkillBatch,
      readReferenceBatch,
      document
    );

    await coordinator.startQuestion("问题");

    expect(readSkillBatch).toHaveBeenCalledTimes(2);
    expect(readReferenceBatch).toHaveBeenCalledTimes(2);
    expect(adapter.sentMessages.some((message) => message.includes("这批 skill 请求的写法不对"))).toBe(true);
    expect(adapter.sentMessages.some((message) => message.includes("这批 read 请求的写法不对"))).toBe(true);
    expect(coordinator.currentState).toBe("completed");
  });

  it("fails after two invalid Reference batches and sends only one correction", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = [
      "```skill\nname: writer\n```",
      "```skill\nname: writer\n```",
      "```skill\nname: writer\n```"
    ];
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn().mockResolvedValue([]),
      vi.fn().mockResolvedValue([{ skillName: "writer", content: "body", byteLength: 4 }]),
      vi.fn(),
      document
    );

    await coordinator.startQuestion("问题");

    expect(adapter.sentMessages.filter((message) => message.includes("这批 read 请求的写法不对"))).toHaveLength(1);
    expect(coordinator.currentState).toBe("failed");
  });

  it("asks once for a direct final answer without executing another read", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = [
      "```skill\nname: writer\n```",
      "```read\npath: writer/references/a.md\n```",
      "```read\npath: writer/references/b.md\n```",
      "最终回答"
    ];
    const readReferenceBatch = vi.fn().mockResolvedValue([
      { virtualPath: "writer/references/a.md", content: "alpha", byteLength: 5 }
    ]);
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn().mockResolvedValue([]),
      vi.fn().mockResolvedValue([{ skillName: "writer", content: "body", byteLength: 4 }]),
      readReferenceBatch,
      document
    );

    await coordinator.startQuestion("问题");

    expect(readReferenceBatch).toHaveBeenCalledOnce();
    expect(adapter.sentMessages.at(-1)).toBe("资料已经全部提供，请不要再发读取请求，直接根据现有内容回答问题。");
    expect(coordinator.currentState).toBe("completed");
  });

  it("cancels a pending answer when the user clicks the native stop control", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = [new Promise<string>(() => {})];
    adapter.stopMode = true;
    const coordinator = new PageTaskCoordinator(adapter, vi.fn().mockResolvedValue([]), vi.fn(), vi.fn(), document);
    coordinator.install();

    const task = coordinator.startQuestion("问题");
    await vi.waitFor(() => expect(adapter.waitedFromCursor).not.toBeNull());
    adapter.sendControl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await task;

    expect(coordinator.currentState).toBe("cancelled");
    expect(adapter.statuses).toEqual([]);
  });

  it("cancels an active task when the user opens another conversation", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = [new Promise<string>(() => {})];
    const coordinator = new PageTaskCoordinator(adapter, vi.fn().mockResolvedValue([]), vi.fn(), vi.fn(), document);
    coordinator.install();
    adapter.conversationNavigation = true;

    const task = coordinator.startQuestion("问题");
    await vi.waitFor(() => expect(adapter.waitedFromCursor).not.toBeNull());
    adapter.conversationLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await task;

    expect(coordinator.currentState).toBe("cancelled");
    expect(adapter.statuses).toEqual([]);
  });

  it("fails immediately when the native internal send throws and does not retry", async () => {
    const adapter = new FakeAdapter();
    adapter.sendError = new Error("发送控件失效。");
    const coordinator = new PageTaskCoordinator(adapter, vi.fn().mockResolvedValue([]), vi.fn(), vi.fn(), document);

    await coordinator.startQuestion("问题");

    expect(adapter.sendAttempts).toBe(1);
    expect(coordinator.currentState).toBe("failed");
  });

  it("runs the after-initial-send hook before waiting for the first model answer", async () => {
    const adapter = new FakeAdapter();
    const order: string[] = [];
    adapter.onWait = () => order.push("wait");
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn().mockResolvedValue([]),
      vi.fn(),
      vi.fn(),
      document,
      {
        afterInitialSend: async () => {
          order.push("hook");
        }
      }
    );

    await coordinator.startQuestion("问题");

    expect(order).toEqual(["hook", "wait"]);
  });

  it("sends the initial Harness immediately and delays Skill reinjection with the configured fixed range", async () => {
    vi.useFakeTimers();
    try {
      const adapter = new FakeAdapter();
      let resolveFinalAnswer!: (answer: string) => void;
      const readSkillBatch = vi.fn().mockResolvedValue([{ skillName: "writer", content: "Skill body", byteLength: 10 }]);
      adapter.answers = [
        "```skill\nname: writer\n```",
        new Promise<string>((resolve) => { resolveFinalAnswer = resolve; })
      ];
      const coordinator = new PageTaskCoordinator(
        adapter,
        vi.fn().mockResolvedValue([]),
        readSkillBatch,
        vi.fn(),
        document,
        { loadSettings: async () => ({ skillEnabled: true, reinjectionDelayMinSeconds: 2, reinjectionDelayMaxSeconds: 2 }) }
      );

      const task = coordinator.startQuestion("问题");
      await flushAsyncWork();
      expect(adapter.sentMessages).toHaveLength(1);
      expect(adapter.sentMessages[0]).toContain("问题");
      expect(readSkillBatch).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1_999);
      expect(adapter.sentMessages).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      await flushAsyncWork();

      expect(adapter.sentMessages).toHaveLength(2);
      expect(adapter.sentMessages[1]).toContain("我把你需要的 Skill 使用说明都放在下面了：");
      resolveFinalAnswer("最终回答");
      await task;
    } finally {
      vi.useRealTimers();
    }
  });

  it("samples reinjection delays as an inclusive integer range", async () => {
    vi.useFakeTimers();
    try {
      const adapter = new FakeAdapter();
      const readSkillBatch = vi.fn().mockResolvedValue([{ skillName: "writer", content: "Skill body", byteLength: 10 }]);
      adapter.answers = ["```skill\nname: writer\n```", "最终回答"];
      const coordinator = new PageTaskCoordinator(
        adapter,
        vi.fn().mockResolvedValue([]),
        readSkillBatch,
        vi.fn(),
        document,
        {
          random: () => 0.999999,
          loadSettings: async () => ({ skillEnabled: true, reinjectionDelayMinSeconds: 2, reinjectionDelayMaxSeconds: 4 })
        }
      );

      const task = coordinator.startQuestion("问题");
      await flushAsyncWork();
      expect(adapter.sentMessages).toHaveLength(1);
      expect(readSkillBatch).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(3_999);
      expect(adapter.sentMessages).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);

      await task;
      expect(adapter.sentMessages[1]).toContain("Skill body");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending delayed reinjection without sending it", async () => {
    vi.useFakeTimers();
    try {
      const adapter = new FakeAdapter();
      adapter.stopMode = true;
      const readSkillBatch = vi.fn().mockResolvedValue([{ skillName: "writer", content: "Skill body", byteLength: 10 }]);
      adapter.answers = ["```skill\nname: writer\n```", "最终回答"];
      const coordinator = new PageTaskCoordinator(
        adapter,
        vi.fn().mockResolvedValue([]),
        readSkillBatch,
        vi.fn(),
        document,
        { loadSettings: async () => ({ skillEnabled: true, reinjectionDelayMinSeconds: 5, reinjectionDelayMaxSeconds: 5 }) }
      );
      coordinator.install();

      const task = coordinator.startQuestion("问题");
      await flushAsyncWork();
      expect(adapter.sentMessages).toHaveLength(1);
      expect(readSkillBatch).toHaveBeenCalledOnce();
      adapter.sendControl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(5_000);
      await task;

      expect(adapter.sentMessages).toHaveLength(1);
      expect(coordinator.currentState).toBe("cancelled");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads MCP details during the normal task flow and commits current-session disclosures", async () => {
    const adapter = new FakeAdapter();
    adapter.sessionId = "session-a";
    adapter.answers = [
      "```mcp\nserver: weather\n```",
      "```skill\nname: writer\n```",
      "最终回答"
    ];
    const loadMcpCatalog = vi.fn().mockResolvedValue([{
      serviceId: "weather",
      displayName: "Weather Tools",
      description: "天气查询",
      toolCount: 1
    }]);
    const loadDisclosures = vi.fn().mockResolvedValue([]);
    const loadDetailsBatch = vi.fn().mockResolvedValue([{
      serviceId: "weather",
      details: mcpDetails("weather")
    }]);
    const commitDisclosures = vi.fn().mockResolvedValue(undefined);
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn().mockResolvedValue([]),
      vi.fn().mockResolvedValue([{ skillName: "writer", content: "Skill body", byteLength: 10 }]),
      vi.fn(),
      document,
      {
        mcp: {
          loadCatalog: loadMcpCatalog,
          loadDisclosures,
          loadDetailsBatch,
          commitDisclosures
        }
      }
    );

    await coordinator.startQuestion("问题");

    expect(loadDisclosures).toHaveBeenCalledWith("session-a");
    expect(loadDetailsBatch).toHaveBeenCalledWith(["weather"]);
    expect(commitDisclosures).toHaveBeenCalledWith("session-a", ["weather"]);
    expect(adapter.sentMessages[0]).toContain("- weather：Weather Tools；天气查询；1 个 Tool");
    expect(adapter.sentMessages[1]).toContain("我把你请求的 MCP 服务详情放在下面了：");
    expect(adapter.sentMessages[1]).toContain("inputSchema");
    expect(coordinator.currentState).toBe("completed");
  });

  it("does not load Skill catalog or session knowledge when Skill is disabled", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = ["最终回答"];
    const loadCatalog = vi.fn().mockResolvedValue([{ name: "writer", description: "Write" }]);
    const loadInitialState = vi.fn().mockResolvedValue(emptySessionToolKnowledgeState());
    const afterInitialSend = vi.fn();
    const coordinator = new PageTaskCoordinator(
      adapter,
      loadCatalog,
      vi.fn(),
      vi.fn(),
      document,
      {
        loadSettings: async () => ({ skillEnabled: false, reinjectionDelayMinSeconds: 0, reinjectionDelayMaxSeconds: 0 }),
        afterInitialSend,
        progressiveKnowledge: { loadInitialState, onFeedbackCommitted: vi.fn() },
        mcp: {
          loadCatalog: vi.fn().mockResolvedValue([]),
          loadDisclosures: vi.fn().mockResolvedValue([]),
          loadDetailsBatch: vi.fn(),
          commitDisclosures: vi.fn()
        }
      }
    );

    await coordinator.startQuestion("问题");

    expect(loadCatalog).not.toHaveBeenCalled();
    expect(loadInitialState).not.toHaveBeenCalled();
    expect(afterInitialSend).not.toHaveBeenCalled();
    expect(adapter.sentMessages[0]).not.toContain("```skill");
    expect(adapter.sentMessages[0]).not.toContain("当前 Skill 目录");
    expect(coordinator.currentState).toBe("completed");
  });

  it("rejects Skill and Reference commands inside a disabled task even if settings later change", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = [
      "```skill\nname: writer\n```",
      "```read\npath: writer/references/a.md\n```"
    ];
    const readSkillBatch = vi.fn();
    const readReferenceBatch = vi.fn();
    let enabled = false;
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn(),
      readSkillBatch,
      readReferenceBatch,
      document,
      {
        loadSettings: async () => {
          const skillEnabled = enabled;
          enabled = true;
          return { skillEnabled, reinjectionDelayMinSeconds: 0, reinjectionDelayMaxSeconds: 0 };
        }
      }
    );

    await coordinator.startQuestion("问题");

    expect(readSkillBatch).not.toHaveBeenCalled();
    expect(readReferenceBatch).not.toHaveBeenCalled();
    expect(adapter.sentMessages[1]).toContain("Skill 功能已停用。");
    expect(coordinator.currentState).toBe("failed");
  });

  it("reports malformed commands as MCP errors when Skill is disabled", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = [
      "```mcp-call\nserver: codexpro\ntool: bash\narguments:\n  command: ego-browser nodejs <<'EOF'\nconst task = await useOrCreateTaskSpace('open baidu');\nEOF\n```",
      "最终回答"
    ];
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      document,
      {
        loadSettings: async () => ({ skillEnabled: false, reinjectionDelayMinSeconds: 0, reinjectionDelayMaxSeconds: 0 })
      }
    );

    await coordinator.startQuestion("问题");

    expect(adapter.sentMessages[1]).toContain("这批 mcp 请求的写法不对，我没有读取。");
    expect(adapter.sentMessages[1]).toContain("请求批次错误：MALFORMED_BODY");
    expect(adapter.sentMessages[1]).not.toContain("Skill 功能已停用。");
    expect(coordinator.currentState).toBe("completed");
  });

  it("uses one MCP correction when details cannot be read in the current page", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = [
      "```mcp\nserver: weather\n```",
      "```skill\nname: writer\n```",
      "最终回答"
    ];
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn().mockResolvedValue([]),
      vi.fn().mockResolvedValue([{ skillName: "writer", content: "Skill body", byteLength: 10 }]),
      vi.fn(),
      document
    );

    await coordinator.startQuestion("问题");

    expect(adapter.sentMessages[1]).toContain("这批 mcp 请求的写法不对，我没有读取。");
    expect(adapter.sentMessages[1]).toContain("当前页面不能读取 MCP 服务详情。");
    expect(coordinator.currentState).toBe("completed");
  });

  it("lets progressive DeepSeek read a Reference directly from a restored Skill gate", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = ["```read\npath: writer/references/style.md\n```", "最终回答"];
    const initial = emptySessionToolKnowledgeState();
    initial.skills.set("writer", "old-digest");
    const readReferenceBatch = vi.fn().mockResolvedValue([{
      virtualPath: "writer/references/style.md",
      content: "Style body",
      byteLength: 10
    }]);
    const committed = vi.fn().mockResolvedValue(undefined);
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn().mockResolvedValue([]),
      vi.fn(),
      readReferenceBatch,
      document,
      { progressiveKnowledge: { loadInitialState: async () => initial, onFeedbackCommitted: committed } }
    );

    await coordinator.startQuestion("问题");

    expect(readReferenceBatch).toHaveBeenCalledWith(["writer/references/style.md"], ["writer"]);
    expect(committed).toHaveBeenCalledWith([expect.objectContaining({ resourceKind: "reference", resourceId: "writer/references/style.md" })]);
    expect(coordinator.currentState).toBe("completed");
  });

  it("allows progressive Skill and Reference reads to alternate and repeat across replies", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = [
      "```skill\nname: writer\n```",
      "```read\npath: writer/references/style.md\n```",
      "```skill\nname: writer\n```",
      "```read\npath: writer/references/style.md\n```",
      "最终回答"
    ];
    const readSkillBatch = vi.fn().mockResolvedValue([{ skillName: "writer", content: "Skill body", byteLength: 10 }]);
    const readReferenceBatch = vi.fn().mockResolvedValue([{ virtualPath: "writer/references/style.md", content: "Style body", byteLength: 10 }]);
    const committed = vi.fn().mockResolvedValue(undefined);
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn().mockResolvedValue([]),
      readSkillBatch,
      readReferenceBatch,
      document,
      { progressiveKnowledge: { loadInitialState: async () => emptySessionToolKnowledgeState(), onFeedbackCommitted: committed } }
    );

    await coordinator.startQuestion("问题");

    expect(readSkillBatch).toHaveBeenCalledTimes(2);
    expect(readReferenceBatch).toHaveBeenCalledTimes(2);
    expect(committed).toHaveBeenCalledTimes(4);
    expect(coordinator.currentState).toBe("completed");
  });

  it("executes progressive MCP Tool calls after user confirmation", async () => {
    const adapter = new FakeAdapter();
    adapter.sessionId = "session-a";
    adapter.answers = [
      [
        "```mcp-call",
        "server: weather",
        "tool: current-weather",
        "arguments:",
        "  city: Shanghai",
        "```"
      ].join("\n"),
      "最终回答"
    ];
    const callTool = vi.fn().mockResolvedValue({
      serviceId: "weather",
      toolName: "current-weather",
      content: "Shanghai: clear",
      contentType: "text",
      isError: false,
      detailSummary: "summary-weather"
    });
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn().mockResolvedValue([]),
      vi.fn(),
      vi.fn(),
      document,
      {
        progressiveKnowledge: { loadInitialState: async () => emptySessionToolKnowledgeState(), onFeedbackCommitted: vi.fn() },
        mcp: {
          loadCatalog: vi.fn().mockResolvedValue([]),
          loadDisclosures: vi.fn().mockResolvedValue([]),
          loadDetailsBatch: vi.fn(),
          commitDisclosures: vi.fn(),
          hasSessionTrust: vi.fn().mockResolvedValue(false),
          confirmToolCall: vi.fn().mockResolvedValue("allow_once"),
          commitSessionTrust: vi.fn(),
          callTool
        }
      }
    );

    await coordinator.startQuestion("问题");

    expect(callTool).toHaveBeenCalledWith("session-a", {
      serviceId: "weather",
      toolName: "current-weather",
      arguments: { city: "Shanghai" }
    });
    expect(adapter.sentMessages[1]).toContain("MCP Tool `weather/current-weather` 返回文本结果：");
    expect(adapter.sentMessages[1]).toContain("Shanghai: clear");
    expect(coordinator.currentState).toBe("completed");
  });

  it("does not delay an MCP Tool result when a confirmation dialog was shown", async () => {
    vi.useFakeTimers();
    try {
      const adapter = new FakeAdapter();
      adapter.sessionId = "session-a";
      adapter.answers = [[
        "```mcp-call",
        "server: weather",
        "tool: current-weather",
        "arguments:",
        "  city: Shanghai",
        "```"
      ].join("\n"), "最终回答"];
      const coordinator = new PageTaskCoordinator(
        adapter,
        vi.fn().mockResolvedValue([]),
        vi.fn(),
        vi.fn(),
        document,
        {
          random: () => 0,
          loadSettings: async () => ({ skillEnabled: true, reinjectionDelayMinSeconds: 5, reinjectionDelayMaxSeconds: 5 }),
          progressiveKnowledge: { loadInitialState: async () => emptySessionToolKnowledgeState(), onFeedbackCommitted: vi.fn() },
          mcp: {
            loadCatalog: vi.fn().mockResolvedValue([]),
            loadDisclosures: vi.fn().mockResolvedValue([]),
            loadDetailsBatch: vi.fn(),
            commitDisclosures: vi.fn(),
            hasSessionTrust: vi.fn().mockResolvedValue(false),
            confirmToolCall: vi.fn().mockResolvedValue("allow_once"),
            callTool: vi.fn().mockResolvedValue({
              serviceId: "weather",
              toolName: "current-weather",
              content: "Shanghai: clear",
              contentType: "text",
              isError: false,
              detailSummary: "summary-weather"
            })
          }
        }
      );

      await coordinator.startQuestion("问题");

      expect(adapter.sentMessages[1]).toContain("Shanghai: clear");
    } finally {
      vi.useRealTimers();
    }
  });

  it("delays trusted-session MCP Tool results when no confirmation dialog is shown", async () => {
    vi.useFakeTimers();
    try {
      const adapter = new FakeAdapter();
      adapter.sessionId = "session-a";
      const callTool = vi.fn().mockResolvedValue({
        serviceId: "weather",
        toolName: "current-weather",
        content: "Shanghai: clear",
        contentType: "text",
        isError: false,
        detailSummary: "summary-weather"
      });
      adapter.answers = [[
        "```mcp-call",
        "server: weather",
        "tool: current-weather",
        "arguments:",
        "  city: Shanghai",
        "```"
      ].join("\n"), "最终回答"];
      const coordinator = new PageTaskCoordinator(
        adapter,
        vi.fn().mockResolvedValue([]),
        vi.fn(),
        vi.fn(),
        document,
        {
          loadSettings: async () => ({ skillEnabled: true, reinjectionDelayMinSeconds: 3, reinjectionDelayMaxSeconds: 3 }),
          progressiveKnowledge: { loadInitialState: async () => emptySessionToolKnowledgeState(), onFeedbackCommitted: vi.fn() },
          mcp: {
            loadCatalog: vi.fn().mockResolvedValue([]),
            loadDisclosures: vi.fn().mockResolvedValue([]),
            loadDetailsBatch: vi.fn(),
            commitDisclosures: vi.fn(),
            hasSessionTrust: vi.fn().mockResolvedValue(true),
            confirmToolCall: vi.fn(),
            callTool
          }
        }
      );

      const task = coordinator.startQuestion("问题");
      await flushAsyncWork();
      expect(adapter.sentMessages).toHaveLength(1);
      expect(callTool).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(2_999);
      expect(adapter.sentMessages).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);

      await task;
      expect(adapter.sentMessages[1]).toContain("Shanghai: clear");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails immediately when persistence after a successful progressive reinjection fails", async () => {
    const adapter = new FakeAdapter();
    adapter.answers = ["```skill\nname: writer\n```", "最终回答"];
    const coordinator = new PageTaskCoordinator(
      adapter,
      vi.fn().mockResolvedValue([]),
      vi.fn().mockResolvedValue([{ skillName: "writer", content: "Skill body", byteLength: 10 }]),
      vi.fn(),
      document,
      {
        progressiveKnowledge: {
          loadInitialState: async () => emptySessionToolKnowledgeState(),
          onFeedbackCommitted: async () => { throw new Error("会话知识数据库写入失败"); }
        }
      }
    );

    await coordinator.startQuestion("问题");

    expect(adapter.sentMessages).toHaveLength(2);
    expect(adapter.statuses.at(-1)).toEqual(["增强失败：会话知识数据库写入失败", "error"]);
    expect(coordinator.currentState).toBe("failed");
  });
});

class FakeAdapter implements SiteTaskPort {
  readonly composer = document.querySelector<HTMLTextAreaElement>('textarea[name="search"]')!;
  readonly sendControl = document.querySelector<HTMLElement>("#send")!;
  readonly conversationLink = document.querySelector<HTMLAnchorElement>("#conversation")!;
  question = "";
  clickDuringSend = false;
  sentMessages: string[] = [];
  statuses: Array<[string, string | undefined]> = [];
  waitedFromCursor: object | null = null;
  assistantCursor: object | null = {};
  disposed = false;
  stopMode = false;
  conversationNavigation = false;
  sendError: Error | null = null;
  asyncSend = false;
  sendAttempts = 0;
  answers: Array<string | Promise<string>> = ["最终回答"];
  onWait: (() => void) | null = null;
  sessionId: string | null = null;

  readComposer(): string | null {
    return this.question;
  }

  isComposerTarget(target: EventTarget | null): boolean {
    return target === this.composer;
  }

  isSendControl(target: EventTarget | null): boolean {
    return target === this.sendControl;
  }

  isStopControl(target: EventTarget | null): boolean {
    return this.stopMode && target === this.sendControl;
  }

  isConversationNavigation(target: EventTarget | null): boolean {
    return this.conversationNavigation && target === this.conversationLink;
  }

  captureAssistantCursor(): object | null {
    return this.assistantCursor;
  }

  getCurrentSessionId(): string | null {
    return this.sessionId;
  }

  async sendMessage(message: string): Promise<void> {
    this.sendAttempts += 1;
    if (this.asyncSend) await Promise.resolve();
    if (this.sendError) throw this.sendError;
    this.sentMessages.push(message);
    if (this.clickDuringSend) {
      this.sendControl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
  }

  async waitForAssistantAnswer(
    previousAssistantCursor: object | null,
    signal?: AbortSignal
  ): Promise<string> {
    this.onWait?.();
    this.waitedFromCursor = previousAssistantCursor;
    this.assistantCursor = {};
    const answer = Promise.resolve(this.answers.shift() ?? "最终回答");
    if (!signal) return await answer;
    return await Promise.race([
      answer,
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("增强任务已取消。")), { once: true });
      })
    ]);
  }

  showStatus(message: string, tone?: "active" | "success" | "error"): void {
    this.statuses.push([message, tone]);
  }

  dispose(): void {
    this.disposed = true;
  }
}

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  }
}

function mcpDetails(serverName: string) {
  return {
    serverName,
    instructions: "Weather tools",
    tools: [{ name: "current", description: "Current weather", inputSchema: { type: "object" } }],
    protocolEra: "modern" as const,
    detailSummary: `summary-${serverName}`,
    detailBytes: 100
  };
}
