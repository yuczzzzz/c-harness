import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { DeepSeekSiteAdapter } from "@/deepseek/site-adapter";
import { parseCommandBatch } from "@/harness/commands";

const fixturePath = resolve("tests/fixtures/deepseek/normal-complete.html");
const commandFixturePath = resolve("tests/fixtures/deepseek/skill-command-batch.html");
const thinkingFixturePath = resolve("tests/fixtures/deepseek/thinking-complete.html");
const composerFixturePaths = [
  resolve("tests/fixtures/deepseek/composer-fast.html"),
  resolve("tests/fixtures/deepseek/composer-expert.html"),
  resolve("tests/fixtures/deepseek/composer-vision.html")
] as const;

describe("DeepSeekSiteAdapter", () => {
  beforeEach(async () => {
    document.body.innerHTML = await readFile(fixturePath, "utf8");
  });

  it("uses only the observed composer and send-control relationship", () => {
    const adapter = new DeepSeekSiteAdapter(document, window);
    const composer = document.querySelector('textarea[name="search"]');
    const send = document.querySelector('[data-observed-control="send"]');
    const attachment = document.querySelector('[data-observed-control="attachment"]');

    expect(adapter.isComposerTarget(composer)).toBe(true);
    expect(adapter.isSendControl(send)).toBe(true);
    expect(adapter.isSendControl(attachment)).toBe(false);
    expect(adapter.captureAssistantCursor()).not.toBeNull();
  });

  it("recognizes the verified active send control as stop but not its disabled state", () => {
    const adapter = new DeepSeekSiteAdapter(document, window);
    const send = document.querySelector<HTMLElement>('[data-observed-control="send"]')!;

    expect(adapter.isStopControl(send)).toBe(false);
    send.classList.remove("ds-button--disabled");
    expect(adapter.isStopControl(send)).toBe(true);
  });

  it("recognizes a different DeepSeek conversation link without matching unrelated links", () => {
    const adapter = new DeepSeekSiteAdapter(document, window);
    const conversation = document.createElement("a");
    conversation.href = "https://chat.deepseek.com/a/chat/s/other";
    const unrelated = document.createElement("a");
    unrelated.href = "https://example.com/";

    expect(adapter.isConversationNavigation(conversation)).toBe(true);
    expect(adapter.isConversationNavigation(unrelated)).toBe(false);
  });

  it("reads session mode from the current DeepSeek URL", () => {
    window.history.replaceState(null, "", "/a/chat/s/test");
    const adapter = new DeepSeekSiteAdapter(document, window);

    expect(adapter.isNewConversation()).toBe(false);
    expect(adapter.getCurrentSessionId()).toBe("test");
  });

  it("does not create project controls in fast, expert, or vision composer fixtures", async () => {
    for (const composerFixturePath of composerFixturePaths) {
      document.body.innerHTML = await readFile(composerFixturePath, "utf8");
      const adapter = new DeepSeekSiteAdapter(document, window);

      expect(document.querySelector("#c-harness-project-control-wrapper")).toBeNull();
      expect(document.querySelector("#c-harness-project-control")).toBeNull();
      expect(document.querySelector("#c-harness-status")).toBeNull();
      adapter.dispose();
    }
  });

  it("clicks the verified send control only once when DeepSeek clears the composer asynchronously", async () => {
    const adapter = new DeepSeekSiteAdapter(document, window);
    const composer = document.querySelector<HTMLTextAreaElement>('textarea[name="search"]')!;
    const send = document.querySelector<HTMLElement>('[data-observed-control="send"]')!;
    const inputListener = vi.fn();
    const clickListener = vi.fn();
    send.classList.remove("ds-button--disabled");
    composer.addEventListener("input", inputListener);
    send.addEventListener("click", () => {
      clickListener();
      window.setTimeout(() => {
        composer.value = "";
      }, 100);
      const userMessage = document.createElement("div");
      userMessage.textContent = "可见的 Harness";
      document.querySelector(".ds-virtual-list-visible-items")?.append(userMessage);
    });

    await adapter.sendMessage("可见的 Harness");

    expect(composer.value).toBe("可见的 Harness");
    expect(inputListener).toHaveBeenCalledOnce();
    expect(clickListener).toHaveBeenCalledOnce();
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    expect(composer.value).toBe("");
  });

  it("restores the original composer value when DeepSeek does not submit the internal send", async () => {
    const adapter = new DeepSeekSiteAdapter(document, window);
    const composer = document.querySelector<HTMLTextAreaElement>('textarea[name="search"]')!;
    composer.value = "原始问题";

    await expect(adapter.sendMessage("可见的 Harness")).rejects.toThrow("DeepSeek 发送按钮未提交消息。");

    expect(composer.value).toBe("原始问题");
  });

  it("keeps error status UI visible outside production builds", () => {
    vi.useFakeTimers();
    const adapter = new DeepSeekSiteAdapter(document, window);

    adapter.showStatus("当前增强任务尚未结束。", "error");

    expect(document.querySelector("#c-harness-status")).toHaveTextContent("当前增强任务尚未结束。");
    vi.advanceTimersByTime(10_000);
    expect(document.querySelector("#c-harness-status")).not.toBeNull();
    vi.useRealTimers();
  });

  it("removes status UI two seconds after showing it in production builds", () => {
    vi.useFakeTimers();
    const adapter = new DeepSeekSiteAdapter(document, window, true);

    adapter.showStatus("当前增强任务尚未结束。", "error");

    vi.advanceTimersByTime(1_999);
    expect(document.querySelector("#c-harness-status")).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(document.querySelector("#c-harness-status")).toBeNull();
    vi.useRealTimers();
  });

  it("extracts the stable final answer without sibling action controls", async () => {
    const adapter = new DeepSeekSiteAdapter(document, window);

    await expect(adapter.waitForAssistantAnswer(null, {
      timeoutMs: 100,
      pollIntervalMs: 1,
      stableChecks: 1
    })).resolves.toBe("已脱敏的最终回答");
  });

  it("returns a stable answer when the restored composer keeps the send control enabled", async () => {
    const adapter = new DeepSeekSiteAdapter(document, window);
    const composer = document.querySelector<HTMLTextAreaElement>('textarea[name="search"]')!;
    const send = document.querySelector<HTMLElement>('[data-observed-control="send"]')!;
    composer.value = "原始问题";
    send.classList.remove("ds-button--disabled");

    await expect(adapter.waitForAssistantAnswer(null, {
      timeoutMs: 100,
      pollIntervalMs: 1,
      stableChecks: 2
    })).resolves.toBe("已脱敏的最终回答");
  });

  it("falls back to virtual-list message items when the old Assistant class is absent", async () => {
    document.body.innerHTML = [
      '<main>',
      '<section class="ds-virtual-list-visible-items">',
      '<div><div>用户消息</div></div>',
      '<div><div>当前页面形态的最终回答</div></div>',
      '</section>',
      '<section class="observed-composer-shell"><div><div><textarea name="search"></textarea></div>',
      '<div><div role="button"></div><div role="button" class="ds-button--disabled"></div></div></div></section>',
      '</main>'
    ].join("");
    const adapter = new DeepSeekSiteAdapter(document, window);

    await expect(adapter.waitForAssistantAnswer(null, {
      timeoutMs: 100,
      pollIntervalMs: 1,
      stableChecks: 1
    })).resolves.toBe("当前页面形态的最终回答");
  });

  it("reconstructs rendered command blocks as explicit fences without banner controls", async () => {
    document.body.innerHTML = await readFile(commandFixturePath, "utf8");
    const adapter = new DeepSeekSiteAdapter(document, window);

    await expect(adapter.waitForAssistantAnswer(null, {
      timeoutMs: 100,
      pollIntervalMs: 1,
      stableChecks: 1
    })).resolves.toBe([
      "```skill",
      "name: milestone4-alpha",
      "```",
      "",
      "```skill",
      "name: milestone4-beta",
      "```"
    ].join("\n"));
  });

  it("tolerates the verified message-list remount during first-message navigation", async () => {
    const adapter = new DeepSeekSiteAdapter(document, window);
    const list = document.querySelector(".ds-virtual-list-visible-items")!;
    list.remove();
    window.setTimeout(() => document.querySelector("main")?.prepend(list), 2);

    await expect(adapter.waitForAssistantAnswer(null, {
      timeoutMs: 100,
      pollIntervalMs: 1,
      stableChecks: 1
    })).resolves.toBe("已脱敏的最终回答");
  });

  it("detects a new Assistant node when virtualization keeps the rendered count unchanged", async () => {
    const adapter = new DeepSeekSiteAdapter(document, window);
    const previousCursor = adapter.captureAssistantCursor();
    const previousAnswer = document.querySelector(".ds-assistant-message-main-content")!;
    const replacement = previousAnswer.cloneNode(true) as HTMLElement;
    replacement.querySelector("span")!.textContent = "虚拟列表替换后的回答";
    previousAnswer.replaceWith(replacement);

    await expect(adapter.waitForAssistantAnswer(previousCursor, {
      timeoutMs: 100,
      pollIntervalMs: 1,
      stableChecks: 1
    })).resolves.toBe("虚拟列表替换后的回答");
  });

  it("extracts only the final answer when the thinking region contains a fake command", async () => {
    document.body.innerHTML = await readFile(thinkingFixturePath, "utf8");
    const adapter = new DeepSeekSiteAdapter(document, window);

    const answer = await adapter.waitForAssistantAnswer(null, {
      timeoutMs: 100,
      pollIntervalMs: 1,
      stableChecks: 1
    });

    expect(answer).toBe("已脱敏的深度思考最终回答");
    expect(parseCommandBatch(answer)).toEqual({ kind: "none" });
  });

  it("fails when the observed message-list invariant is absent", async () => {
    document.querySelector(".ds-virtual-list-visible-items")?.remove();
    const adapter = new DeepSeekSiteAdapter(document, window);

    await expect(adapter.waitForAssistantAnswer(null, { timeoutMs: 10, pollIntervalMs: 1 }))
      .rejects.toThrow("无法确认 DeepSeek 当前会话消息列表");
  });

  it("aborts a pending poll immediately", async () => {
    document.querySelector(".ds-virtual-list-visible-items")?.remove();
    const adapter = new DeepSeekSiteAdapter(document, window);
    const controller = new AbortController();
    const waiting = adapter.waitForAssistantAnswer(null, {
      timeoutMs: 10_000,
      pollIntervalMs: 10_000,
      signal: controller.signal
    });

    controller.abort(new Error("增强任务已取消。"));

    await expect(waiting).rejects.toThrow("增强任务已取消。");
  });
});
