import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseCommandBatch } from "@/harness/commands";
import { ZaiSiteAdapter } from "@/zai/site-adapter";

const normalFixturePath = resolve("tests/fixtures/zai/normal-complete.html");
const thinkingFixturePath = resolve("tests/fixtures/zai/thinking-complete.html");
const foldableThinkingFixturePath = resolve("tests/fixtures/zai/foldable-thinking-complete.html");
const commandFixturePath = resolve("tests/fixtures/zai/skill-command-batch.html");

describe("ZaiSiteAdapter", () => {
  beforeEach(async () => {
    document.body.innerHTML = await readFile(normalFixturePath, "utf8");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gates composer and send interception to native Chat mode", () => {
    const adapter = new ZaiSiteAdapter(document, window);
    const composer = document.querySelector("#chat-input");
    const send = document.querySelector("#send-message-button");
    const chatMode = document.querySelector<HTMLButtonElement>('#sidebar-new-chat-button[data-active="true"]')!;
    const agentMode = chatMode.nextElementSibling as HTMLButtonElement;

    expect(adapter.isComposerTarget(composer)).toBe(true);
    expect(adapter.isSendControl(send)).toBe(true);

    chatMode.dataset.active = "false";
    agentMode.dataset.active = "true";
    expect(adapter.readComposer()).toBeNull();
    expect(adapter.isComposerTarget(composer)).toBe(false);
    expect(adapter.isSendControl(send)).toBe(false);
  });

  it("recognizes only z.ai new Chat and strict UUID conversation URLs in Chat mode", () => {
    const adapter = new ZaiSiteAdapter(document, window);
    const chatMode = document.querySelector<HTMLButtonElement>('#sidebar-new-chat-button[data-active="true"]')!;
    const agentMode = chatMode.nextElementSibling as HTMLButtonElement;

    window.history.replaceState(null, "", "/");
    expect(adapter.isNewConversation()).toBe(true);
    expect(adapter.getCurrentSessionId()).toBeNull();

    window.history.replaceState(null, "", "/c/483140bb-6bf8-426d-a55a-2d056bc94cfb");
    expect(adapter.isNewConversation()).toBe(false);
    expect(adapter.getCurrentSessionId()).toBe("483140bb-6bf8-426d-a55a-2d056bc94cfb");

    window.history.replaceState(null, "", "/c/not-a-uuid");
    expect(adapter.getCurrentSessionId()).toBeNull();

    chatMode.dataset.active = "false";
    agentMode.dataset.active = "true";
    window.history.replaceState(null, "", "/");
    expect(adapter.isNewConversation()).toBe(false);
  });

  it("rejects ambiguous mode groups instead of using the idle send control fallback", () => {
    const originalGroup = document.querySelector<HTMLElement>("[data-observed-mode-group]")!;
    originalGroup.parentElement?.append(originalGroup.cloneNode(true));
    const adapter = new ZaiSiteAdapter(document, window);

    expect(adapter.readComposer()).toBeNull();
  });

  it("keeps Chat mode on the collapsed narrow layout when all mode markers are absent", () => {
    document.querySelectorAll("[data-observed-mode-group] > button")
      .forEach((button) => button.removeAttribute("data-active"));
    const adapter = new ZaiSiteAdapter(document, window);

    window.history.replaceState(null, "", "/");

    expect(adapter.readComposer()).toBe("");
    expect(adapter.isNewConversation()).toBe(true);
  });

  it("keeps Chat mode while the collapsed sidebar is generating without a send control", () => {
    const chatMode = document.querySelector<HTMLButtonElement>('#sidebar-new-chat-button[data-active="true"]')!;
    const agentMode = chatMode.nextElementSibling as HTMLButtonElement;
    chatMode.removeAttribute("id");
    document.querySelector<HTMLButtonElement>("#send-message-button")?.remove();
    const stop = document.createElement("button");
    chatMode.closest("[data-observed-mode-group]")?.replaceChildren(chatMode, agentMode);
    document.querySelector("form")?.append(stop);
    const adapter = new ZaiSiteAdapter(document, window);

    expect(adapter.readComposer()).toBe("");
    expect(adapter.isStopControl(stop)).toBe(true);

    chatMode.dataset.active = "false";
    agentMode.dataset.active = "true";
    expect(adapter.readComposer()).toBeNull();
    expect(adapter.isStopControl(stop)).toBe(false);
  });

  it("does not create project controls or directory selection APIs", () => {
    const adapter = new ZaiSiteAdapter(document, window);

    expect("renderProjectControl" in adapter).toBe(false);
    expect("selectProjectDirectory" in adapter).toBe(false);
    expect(document.querySelector("#c-harness-project-control-wrapper")).toBeNull();
    expect(document.querySelector("#c-harness-project-control")).toBeNull();
  });

  it("sets the native composer value and clicks only the identified send button", async () => {
    const adapter = new ZaiSiteAdapter(document, window);
    const composer = document.querySelector<HTMLTextAreaElement>("#chat-input")!;
    const send = document.querySelector<HTMLButtonElement>("#send-message-button")!;
    const auxiliary = document.querySelector<HTMLButtonElement>("#upload-file-button")!;
    const sendClick = vi.fn();
    const auxiliaryClick = vi.fn();
    composer.addEventListener("input", () => { send.disabled = false; });
    send.addEventListener("click", (event) => {
      event.preventDefault();
      sendClick();
    });
    auxiliary.addEventListener("click", auxiliaryClick);

    await adapter.sendMessage("Visible Harness");

    expect(composer.value).toBe("Visible Harness");
    expect(sendClick).toHaveBeenCalledOnce();
    expect(auxiliaryClick).not.toHaveBeenCalled();
  });

  it("waits for the controlled composer to enable send before clicking", async () => {
    vi.useFakeTimers();
    const adapter = new ZaiSiteAdapter(document, window);
    const composer = document.querySelector<HTMLTextAreaElement>("#chat-input")!;
    const send = document.querySelector<HTMLButtonElement>("#send-message-button")!;
    const sendClick = vi.fn();
    send.disabled = true;
    composer.addEventListener("input", () => {
      window.setTimeout(() => { send.disabled = false; }, 50);
    });
    send.addEventListener("click", (event) => {
      event.preventDefault();
      sendClick();
    });

    const sending = adapter.sendMessage("Visible Harness");
    expect(sendClick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    await sending;

    expect(sendClick).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("recognizes the form's last button as stop only while the send button is absent", () => {
    const adapter = new ZaiSiteAdapter(document, window);
    const send = document.querySelector("#send-message-button")!;
    const stop = document.createElement("button");
    const icon = document.createElement("span");
    stop.append(icon);
    send.replaceWith(stop);

    expect(adapter.isStopControl(icon)).toBe(true);
    expect(adapter.isSendControl(stop)).toBe(false);
  });

  it("cancels for new Chat, Agent, and other conversations but not Chat Menu", () => {
    const adapter = new ZaiSiteAdapter(document, window);
    const newChat = Array.from(document.querySelectorAll("#sidebar-new-chat-button"))
      .find((button) => !button.hasAttribute("data-active")) ?? null;
    const mode = document.querySelector('#sidebar-new-chat-button[data-active]')!;
    const agent = mode.parentElement?.querySelectorAll(":scope > button").item(1) ?? null;
    const other = document.querySelector('button[draggable="false"][data-selected="false"]');
    const menu = other?.querySelector('button[aria-label="Chat Menu"]') ?? null;

    expect(adapter.isConversationNavigation(newChat)).toBe(true);
    expect(adapter.isConversationNavigation(agent)).toBe(true);
    expect(adapter.isConversationNavigation(other)).toBe(true);
    expect(adapter.isConversationNavigation(menu)).toBe(false);
  });

  it("extracts a stable ordinary final answer", async () => {
    const adapter = new ZaiSiteAdapter(document, window);

    await expect(adapter.waitForAssistantAnswer(null, {
      idleTimeoutMs: 100,
      absoluteTimeoutMs: 1_000,
      pollIntervalMs: 1,
      stableChecks: 1
    })).resolves.toBe("Sanitized final answer");
  });

  it("finishes after the send control returns even when the next draft enables it", async () => {
    const send = document.querySelector<HTMLButtonElement>("#send-message-button")!;
    send.disabled = false;
    const adapter = new ZaiSiteAdapter(document, window);

    await expect(adapter.waitForAssistantAnswer(null, {
      idleTimeoutMs: 20,
      absoluteTimeoutMs: 1_000,
      pollIntervalMs: 1,
      stableChecks: 1
    })).resolves.toBe("Sanitized final answer");
  });

  it("removes thinking content including fake commands", async () => {
    document.body.innerHTML = await readFile(thinkingFixturePath, "utf8");
    const adapter = new ZaiSiteAdapter(document, window);

    const answer = await adapter.waitForAssistantAnswer(null, {
      idleTimeoutMs: 100,
      absoluteTimeoutMs: 1_000,
      pollIntervalMs: 1,
      stableChecks: 1
    });

    expect(answer).toBe("Sanitized thinking final answer");
    expect(parseCommandBatch(answer)).toEqual({ kind: "none" });
  });

  it("removes the GLM-5V foldable thinking card including fake commands", async () => {
    document.body.innerHTML = await readFile(foldableThinkingFixturePath, "utf8");
    const adapter = new ZaiSiteAdapter(document, window);

    const answer = await adapter.waitForAssistantAnswer(null, {
      idleTimeoutMs: 100,
      absoluteTimeoutMs: 1_000,
      pollIntervalMs: 1,
      stableChecks: 1
    });

    expect(answer).toBe("Sanitized foldable thinking final answer");
    expect(parseCommandBatch(answer)).toEqual({ kind: "none" });
  });

  it("reconstructs two rendered commands in order without toolbar text", async () => {
    document.body.innerHTML = await readFile(commandFixturePath, "utf8");
    const adapter = new ZaiSiteAdapter(document, window);

    await expect(adapter.waitForAssistantAnswer(null, {
      idleTimeoutMs: 100,
      absoluteTimeoutMs: 1_000,
      pollIntervalMs: 1,
      stableChecks: 1
    })).resolves.toBe([
      "```skill",
      "name: alpha-skill",
      "```",
      "",
      "```skill",
      "name: beta-skill",
      "```"
    ].join("\n"));
  });

  it("leaves old project command labels inert", async () => {
    document.body.innerHTML = await readFile(commandFixturePath, "utf8");
    document.querySelectorAll(".language-skill").forEach((element) => {
      element.classList.remove("language-skill");
      element.classList.add("language-sk-read");
    });
    const adapter = new ZaiSiteAdapter(document, window);

    const answer = await adapter.waitForAssistantAnswer(null, {
      idleTimeoutMs: 100,
      absoluteTimeoutMs: 1_000,
      pollIntervalMs: 1,
      stableChecks: 1
    });

    expect(answer).toBe("name: alpha-skill");
    expect(parseCommandBatch(answer)).toEqual({ kind: "none" });
  });

  it("detects a replacement Assistant when the rendered count stays unchanged", async () => {
    const adapter = new ZaiSiteAdapter(document, window);
    const cursor = adapter.captureAssistantCursor();
    const previous = document.querySelector(".chat-assistant")!;
    const replacement = previous.cloneNode(true) as HTMLElement;
    replacement.querySelector("p")!.textContent = "Replacement answer";
    previous.replaceWith(replacement);

    await expect(adapter.waitForAssistantAnswer(cursor, {
      idleTimeoutMs: 100,
      absoluteTimeoutMs: 1_000,
      pollIntervalMs: 1,
      stableChecks: 1
    })).resolves.toBe("Replacement answer");
  });

  it("fails explicitly when the final response container is absent", async () => {
    document.querySelector("#response-content-container")?.remove();
    const adapter = new ZaiSiteAdapter(document, window);

    await expect(adapter.waitForAssistantAnswer(null, {
      idleTimeoutMs: 100,
      absoluteTimeoutMs: 1_000,
      pollIntervalMs: 1,
      stableChecks: 1
    })).rejects.toThrow("无法确认 z.ai 最终正文容器");
  });

  it("fails rather than guessing a recognized command without CodeMirror content", async () => {
    document.body.innerHTML = await readFile(commandFixturePath, "utf8");
    document.querySelector(".cm-content")?.remove();
    const adapter = new ZaiSiteAdapter(document, window);

    await expect(adapter.waitForAssistantAnswer(null, {
      idleTimeoutMs: 100,
      absoluteTimeoutMs: 1_000,
      pollIntervalMs: 1,
      stableChecks: 1
    })).rejects.toThrow("无法确认 z.ai skill 命令正文");
  });

  it("renews the idle deadline when Assistant thinking or body text changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const assistant = document.querySelector<HTMLElement>(".chat-assistant")!;
    const response = assistant.querySelector<HTMLElement>("#response-content-container")!;
    const send = document.querySelector<HTMLButtonElement>("#send-message-button")!;
    assistant.remove();
    send.remove();
    const adapter = new ZaiSiteAdapter(document, window);
    const waiting = adapter.waitForAssistantAnswer(null, {
      idleTimeoutMs: 100,
      absoluteTimeoutMs: 500,
      pollIntervalMs: 10,
      stableChecks: 1
    });

    await vi.advanceTimersByTimeAsync(80);
    document.body.append(assistant);
    await vi.advanceTimersByTimeAsync(80);
    response.textContent = "Still thinking";
    await vi.advanceTimersByTimeAsync(80);
    response.textContent = "Long final answer";
    send.disabled = true;
    document.querySelector("form")?.append(send);
    await vi.advanceTimersByTimeAsync(10);

    await expect(waiting).resolves.toBe("Long final answer");
  });

  it("fails after the idle deadline without observable progress", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    document.querySelector(".chat-assistant")?.remove();
    document.querySelector("#send-message-button")?.remove();
    const adapter = new ZaiSiteAdapter(document, window);
    const waiting = adapter.waitForAssistantAnswer(null, {
      idleTimeoutMs: 100,
      absoluteTimeoutMs: 500,
      pollIntervalMs: 10
    });
    const rejection = expect(waiting).rejects.toThrow("连续 2 分钟无回答进度");

    await vi.advanceTimersByTimeAsync(100);

    await rejection;
  });

  it("fails at the absolute deadline despite continuous progress", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const assistant = document.querySelector<HTMLElement>(".chat-assistant")!;
    document.querySelector("#send-message-button")?.remove();
    const progress = window.setInterval(() => {
      assistant.dataset.progress = String(Number(assistant.dataset.progress ?? "0") + 1);
      assistant.querySelector("p")!.textContent = assistant.dataset.progress;
    }, 40);
    const adapter = new ZaiSiteAdapter(document, window);
    const waiting = adapter.waitForAssistantAnswer(null, {
      idleTimeoutMs: 100,
      absoluteTimeoutMs: 250,
      pollIntervalMs: 10
    });
    const rejection = expect(waiting).rejects.toThrow("单轮等待超过 15 分钟");

    await vi.advanceTimersByTimeAsync(250);
    window.clearInterval(progress);

    await rejection;
  });

  it("requires the completed final body to remain stable across checks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const adapter = new ZaiSiteAdapter(document, window);
    let settled = false;
    const waiting = adapter.waitForAssistantAnswer(null, {
      idleTimeoutMs: 100,
      absoluteTimeoutMs: 500,
      pollIntervalMs: 10,
      stableChecks: 2
    }).then((answer) => {
      settled = true;
      return answer;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(10);

    await expect(waiting).resolves.toBe("Sanitized final answer");
  });

  it("aborts a pending poll immediately", async () => {
    document.querySelector(".chat-assistant")?.remove();
    document.querySelector("#send-message-button")?.remove();
    const adapter = new ZaiSiteAdapter(document, window);
    const controller = new AbortController();
    const waiting = adapter.waitForAssistantAnswer(null, {
      idleTimeoutMs: 10_000,
      absoluteTimeoutMs: 20_000,
      pollIntervalMs: 10_000,
      signal: controller.signal
    });

    controller.abort(new Error("增强任务已取消。"));

    await expect(waiting).rejects.toThrow("增强任务已取消。");
  });
});
