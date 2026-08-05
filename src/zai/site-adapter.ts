import { HARNESS_COMMAND_KINDS, type HarnessCommandKind } from "@/harness/commands";

const SIDEBAR_SELECTOR = "#sidebar";
const NEW_CHAT_SELECTOR = '#sidebar-new-chat-button:not([data-active])';
const COMPOSER_SELECTOR = "textarea#chat-input";
const SEND_CONTROL_SELECTOR = "button#send-message-button";
const ASSISTANT_SELECTOR = ".chat-assistant";
const RESPONSE_SELECTOR = "#response-content-container";
const FOLDABLE_THINKING_DETAILS_SELECTOR = ".detailsSubContainer > blockquote";
const STATUS_ID = "c-harness-status";
const STATUS_VISIBLE_MS = 2_000;
const SEND_READY_TIMEOUT_MS = 2_000;
const SEND_READY_POLL_MS = 25;
const ZAI_SESSION_PATTERN = /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const TOOL_COMMAND_SELECTOR = HARNESS_COMMAND_KINDS.map((kind) => `.language-${kind}`).join(",");

export interface ZaiWaitForAnswerOptions {
  idleTimeoutMs?: number;
  absoluteTimeoutMs?: number;
  pollIntervalMs?: number;
  stableChecks?: number;
  signal?: AbortSignal;
}

/** 封装所有已验证的 z.ai Chat DOM 知识和输入框交互。 */
export class ZaiSiteAdapter {
  readonly siteName = "z.ai";
  private statusTimeout: number | null = null;

  constructor(
    private readonly pageDocument: Document = document,
    private readonly pageWindow: Window = window
  ) {}

  /** 仅在 z.ai 处于 Chat 模式时返回当前原生输入框文本。 */
  readComposer(): string | null {
    return this.isChatMode() ? this.getComposer()?.value ?? null : null;
  }

  /** 返回事件目标是否为已验证的 Chat 输入框。 */
  isComposerTarget(target: EventTarget | null): boolean {
    return this.isChatMode() && target === this.getComposer();
  }

  /** 返回事件目标是否为唯一的 z.ai 发送控件。 */
  isSendControl(target: EventTarget | null): boolean {
    const button = target instanceof Element ? target.closest("button") : null;
    return this.isChatMode() && Boolean(button && button === this.getSendControl());
  }

  /** 返回点击目标是否为当前表单中已观测到的停止控件。 */
  isStopControl(target: EventTarget | null): boolean {
    const button = target instanceof Element ? target.closest("button") : null;
    return this.isChatMode() && !this.getSendControl() && Boolean(button && button === this.getPrimaryControl());
  }

  /** 返回点击操作是否会离开当前 z.ai Chat 对话或模式。 */
  isConversationNavigation(target: EventTarget | null): boolean {
    const element = target instanceof Element ? target : null;
    if (!element || element.closest('button[aria-label="Chat Menu"]')) return false;
    const button = element.closest<HTMLButtonElement>("button");
    if (!button) return false;
    if (button.matches(NEW_CHAT_SELECTOR) || button === this.getAgentModeControl()) return true;
    return button.matches('button[draggable="false"][data-selected="false"]');
  }

  /** 从 `/c/{uuid}` 返回稳定的 z.ai 对话 UUID；不在已绑定的对话 URL 中时返回 null。 */
  getCurrentSessionId(): string | null {
    if (!this.isChatMode()) return null;
    return this.pageWindow.location.pathname.match(ZAI_SESSION_PATTERN)?.[1] ?? null;
  }

  /** 返回当前 z.ai Chat URL 是否为原生新对话界面。 */
  isNewConversation(): boolean {
    return this.isChatMode() && this.pageWindow.location.pathname === "/";
  }

  /** 捕获最新的 z.ai Assistant 节点作为对象标识游标。 */
  captureAssistantCursor(): object | null {
    const answers = this.pageDocument.querySelectorAll<HTMLElement>(ASSISTANT_SELECTOR);
    return answers.item(answers.length - 1) ?? null;
  }

  /** 替换输入框文本，等待 z.ai 接受后点击真实发送按钮。 */
  async sendMessage(message: string): Promise<void> {
    if (!this.isChatMode()) throw new Error("无法确认 z.ai Chat 模式。");
    const composer = this.getComposer();
    const sendControl = this.getSendControl();
    if (!composer || !sendControl) throw new Error("无法确认 z.ai 输入框或发送按钮。");

    const textareaConstructor = composer.ownerDocument.defaultView?.HTMLTextAreaElement;
    const inputEventConstructor = composer.ownerDocument.defaultView?.Event;
    const valueSetter = textareaConstructor
      ? Object.getOwnPropertyDescriptor(textareaConstructor.prototype, "value")?.set
      : undefined;
    if (!valueSetter) throw new Error("无法设置 z.ai 输入框内容。");
    if (!inputEventConstructor) throw new Error("无法创建 z.ai 输入事件。");
    valueSetter.call(composer, message);
    composer.dispatchEvent(new inputEventConstructor("input", { bubbles: true }));
    await this.waitForSendControlReady(sendControl);
    sendControl.click();
  }

  /** 等待一个新的 z.ai Assistant 最终回答及稳定的完整文本。 */
  async waitForAssistantAnswer(
    previousAssistantCursor: object | null,
    optionsOrSignal: ZaiWaitForAnswerOptions | AbortSignal = {}
  ): Promise<string> {
    const options = isAbortSignal(optionsOrSignal) ? { signal: optionsOrSignal } : optionsOrSignal;
    const idleTimeoutMs = options.idleTimeoutMs ?? 120_000;
    const absoluteTimeoutMs = options.absoluteTimeoutMs ?? 900_000;
    const pollIntervalMs = options.pollIntervalMs ?? 400;
    const stableChecks = options.stableChecks ?? 2;
    const startedAt = Date.now();
    let lastProgressAt = startedAt;
    let observedAssistant: object | null = previousAssistantCursor;
    let observedAssistantText = "";
    let observedControlState = this.getGenerationControlState();
    let previousText = "";
    let stableCount = 0;

    while (true) {
      options.signal?.throwIfAborted();
      if (!this.isChatMode()) throw new Error("无法确认 z.ai Chat 模式。");

      // 步骤 1：每次已验证的生成状态变化都刷新空闲时间窗口。
      const answers = this.pageDocument.querySelectorAll<HTMLElement>(ASSISTANT_SELECTOR);
      const latest = answers.item(answers.length - 1);
      const hasNewAnswer = Boolean(latest && latest !== previousAssistantCursor);
      const assistantText = latest ? visibleText(latest) : "";
      const controlState = this.getGenerationControlState();
      if (
        latest !== observedAssistant ||
        assistantText !== observedAssistantText ||
        controlState !== observedControlState
      ) {
        lastProgressAt = Date.now();
        observedAssistant = latest;
        observedAssistantText = assistantText;
        observedControlState = controlState;
      }

      // 步骤 2：即使有进展也执行绝对时限，否则执行空闲时限。
      const now = Date.now();
      if (now - startedAt >= absoluteTimeoutMs) throw new Error("单轮等待超过 15 分钟。");
      if (now - lastProgressAt >= idleTimeoutMs) throw new Error("连续 2 分钟无回答进度。");

      // 步骤 3：发送控件恢复即代表生成结束；禁用状态还会受用户下一条草稿影响。
      const sendControl = this.getSendControl();
      const generationEnded = Boolean(sendControl);

      // 步骤 4：仅提取并稳定已移除思考内容的完整最终正文。
      if (latest && hasNewAnswer && generationEnded) {
        const text = extractAssistantAnswer(latest);
        if (text) {
          stableCount = text === previousText ? stableCount + 1 : 1;
          previousText = text;
          if (stableCount >= stableChecks) return text;
        } else {
          stableCount = 0;
          previousText = "";
        }
      } else {
        stableCount = 0;
        previousText = "";
      }
      await abortableDelay(this.pageWindow, pollIntervalMs, options.signal);
    }
  }

  /** 在 z.ai 输入框旁显示固定且不会引发布局偏移的状态。 */
  showStatus(message: string, tone: "active" | "success" | "error" = "active"): void {
    const composer = this.getComposer();
    if (!composer) return;
    let status = this.pageDocument.querySelector<HTMLElement>(`#${STATUS_ID}`);
    if (!status) {
      status = this.pageDocument.createElement("div");
      status.id = STATUS_ID;
      status.style.cssText = [
        "position:fixed",
        "z-index:2147483647",
        "padding:4px 8px",
        "border-radius:4px",
        "font:12px/1.4 system-ui,sans-serif",
        "box-shadow:0 1px 4px rgba(0,0,0,.16)",
        "pointer-events:none"
      ].join(";");
      this.pageDocument.body.append(status);
    }
    const rect = composer.getBoundingClientRect();
    status.style.left = `${Math.max(8, rect.left)}px`;
    status.style.top = `${Math.max(8, rect.top - 30)}px`;
    status.style.color = tone === "error" ? "#8c1d18" : tone === "success" ? "#0f5132" : "#3c4043";
    status.style.background = tone === "error" ? "#fce8e6" : tone === "success" ? "#d1e7dd" : "#ffffff";
    status.textContent = message;
    this.clearStatusTimer();
    this.statusTimeout = this.pageWindow.setTimeout(() => {
      status.remove();
      this.statusTimeout = null;
    }, STATUS_VISIBLE_MS);
  }

  /** 从当前页面移除扩展创建的状态 UI。 */
  dispose(): void {
    this.clearStatusTimer();
    this.pageDocument.querySelector(`#${STATUS_ID}`)?.remove();
  }

  private isChatMode(): boolean {
    const modeControls = this.getModeControls();
    if (modeControls) {
      return modeControls[0].dataset.active === "true" && modeControls[1].dataset.active === "false";
    }
    if (this.pageDocument.querySelector(`${SIDEBAR_SELECTOR} button[data-active]`)) return false;
    return Boolean(this.pageDocument.querySelector(COMPOSER_SELECTOR)?.closest("form")?.querySelector(SEND_CONTROL_SELECTOR));
  }

  private getComposer(): HTMLTextAreaElement | null {
    return this.pageDocument.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR);
  }

  private getSendControl(): HTMLButtonElement | null {
    return this.getComposer()?.closest("form")?.querySelector<HTMLButtonElement>(SEND_CONTROL_SELECTOR) ?? null;
  }

  private getPrimaryControl(): HTMLButtonElement | null {
    const buttons = this.getComposer()?.closest("form")?.querySelectorAll<HTMLButtonElement>("button");
    return buttons?.item(buttons.length - 1) ?? null;
  }

  private getGenerationControlState(): string {
    const sendControl = this.getSendControl();
    if (sendControl) return `send:${sendControl.disabled}`;
    return `stop:${Boolean(this.getPrimaryControl())}`;
  }

  private getAgentModeControl(): HTMLButtonElement | null {
    return this.getModeControls()?.[1] ?? null;
  }

  private getModeControls(): [HTMLButtonElement, HTMLButtonElement] | null {
    const sidebar = this.pageDocument.querySelector(SIDEBAR_SELECTOR);
    if (!sidebar) return null;
    const controls = sidebar.querySelectorAll<HTMLButtonElement>("button[data-active]");
    if (controls.length !== 2 || controls.item(0).parentElement !== controls.item(1).parentElement) return null;
    return [controls.item(0), controls.item(1)];
  }

  private async waitForSendControlReady(sendControl: HTMLButtonElement): Promise<void> {
    const deadline = Date.now() + SEND_READY_TIMEOUT_MS;
    while (sendControl.disabled && Date.now() < deadline) {
      await abortableDelay(this.pageWindow, SEND_READY_POLL_MS);
    }
    if (sendControl.disabled) throw new Error("z.ai 发送按钮未在输入后启用。");
  }

  private clearStatusTimer(): void {
    if (this.statusTimeout === null) return;
    this.pageWindow.clearTimeout(this.statusTimeout);
    this.statusTimeout = null;
  }

}

// 仅重建显式读取命令，同时排除思考内容和代码工具栏文本。
function extractAssistantAnswer(answer: HTMLElement): string {
  const response = answer.querySelector<HTMLElement>(RESPONSE_SELECTOR);
  if (!response) throw new Error("无法确认 z.ai 最终正文容器。");
  const clone = response.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".thinking-chain-container").forEach((element) => element.remove());
  clone.querySelectorAll(FOLDABLE_THINKING_DETAILS_SELECTOR).forEach((details) => {
    details.closest(".markdown-prose > div")?.remove();
  });
  return collectRenderedBlocks(clone).filter(Boolean).join("\n\n").trim();
}

function collectRenderedBlocks(root: Element): string[] {
  const blocks: string[] = [];
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim();
      if (text) blocks.push(text);
      continue;
    }
    if (!(child instanceof Element)) continue;
    if (isCommandContainer(child)) {
      blocks.push(reconstructCommand(child));
      continue;
    }
    const directCommands = Array.from(child.children).filter(isCommandContainer);
    if (directCommands.length > 0) {
      blocks.push(...directCommands.map(reconstructCommand));
      continue;
    }
    const inertCodeText = extractInertCodeText(child);
    if (inertCodeText) {
      blocks.push(inertCodeText);
      continue;
    }
    if (isSemanticTextBlock(child) && !child.querySelector(TOOL_COMMAND_SELECTOR)) {
      const text = visibleText(child);
      if (text) blocks.push(text);
      continue;
    }
    blocks.push(...collectRenderedBlocks(child));
  }
  return blocks;
}

function isCommandContainer(element: Element): boolean {
  return element.matches(TOOL_COMMAND_SELECTOR);
}

function reconstructCommand(element: Element): string {
  const language = commandKindForElement(element);
  const content = element.querySelector<HTMLElement>(".cm-content");
  if (!content) throw new Error(`无法确认 z.ai ${language} 命令正文。`);
  const lines = Array.from(content.querySelectorAll<HTMLElement>(".cm-line"), (line) => line.textContent ?? "");
  const body = (lines.length > 0 ? lines.join("\n") : visibleText(content)).trim();
  const fence = markdownFenceFor(body);
  return `${fence}${language}\n${body}\n${fence}`;
}

function extractInertCodeText(element: Element): string | null {
  if (element.matches(TOOL_COMMAND_SELECTOR) || element.querySelector(TOOL_COMMAND_SELECTOR)) return null;
  const content = element.querySelector<HTMLElement>(".cm-content");
  if (!content) return null;
  const lines = Array.from(content.querySelectorAll<HTMLElement>(".cm-line"), (line) => line.textContent ?? "");
  return (lines.length > 0 ? lines.join("\n") : visibleText(content)).trim() || null;
}

function commandKindForElement(element: Element): HarnessCommandKind {
  const kind = HARNESS_COMMAND_KINDS.find((candidate) => element.classList.contains(`language-${candidate}`));
  if (!kind) throw new Error("无法确认 z.ai 命令语言。");
  return kind;
}

function isSemanticTextBlock(element: Element): boolean {
  return /^(?:BLOCKQUOTE|H[1-6]|LI|P|PRE|TABLE)$/u.test(element.tagName);
}

function visibleText(element: Element): string {
  const htmlElement = element as HTMLElement;
  return (htmlElement.innerText ?? htmlElement.textContent ?? "").trim();
}

function markdownFenceFor(content: string): string {
  const longestRun = Math.max(0, ...Array.from(content.matchAll(/`+/gu), (match) => match[0].length));
  return "`".repeat(Math.max(3, longestRun + 1));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isAbortSignal(value: ZaiWaitForAnswerOptions | AbortSignal): value is AbortSignal {
  return "aborted" in value && "addEventListener" in value;
}

function abortableDelay(pageWindow: Window, delayMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => pageWindow.setTimeout(resolve, delayMs));
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timeout = pageWindow.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      pageWindow.clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
