const COMPOSER_SELECTOR = 'textarea[name="search"]';
const MESSAGE_LIST_SELECTOR = ".ds-virtual-list-visible-items";
const ASSISTANT_CONTENT_SELECTOR = ".ds-assistant-message-main-content";
const STATUS_ID = "c-harness-status";
const STATUS_VISIBLE_MS = 2_000;
const SEND_READY_TIMEOUT_MS = 2_000;
const SEND_READY_POLL_MS = 50;

export interface WaitForAnswerOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  stableChecks?: number;
  signal?: AbortSignal;
}

/** 封装所有已验证的 DeepSeek DOM 知识和输入框交互。 */
export class DeepSeekSiteAdapter {
  readonly siteName = "DeepSeek";
  private statusTimeout: number | null = null;

  constructor(
    private readonly pageDocument: Document = document,
    private readonly pageWindow: Window = window,
    private readonly isProductionBuild = import.meta.env.COMMAND === "build"
  ) {}

  /** 返回当前原生输入框文本；无法确认其结构时返回 null。 */
  readComposer(): string | null {
    return this.getComposer()?.value ?? null;
  }

  /** 返回事件目标是否为当前输入框中已验证的发送控件。 */
  isSendControl(target: EventTarget | null): boolean {
    const element = target instanceof Element ? target.closest('[role="button"]') : null;
    return Boolean(element && element === this.getSendControl());
  }

  /** 返回点击目标是否为已验证且处于活动状态的原生停止控件。 */
  isStopControl(target: EventTarget | null): boolean {
    const element = target instanceof Element ? target.closest('[role="button"]') : null;
    return Boolean(
      element &&
      element === this.getSendControl() &&
      !element.classList.contains("ds-button--disabled")
    );
  }

  /** 返回点击操作是否会打开另一个 DeepSeek 对话。 */
  isConversationNavigation(target: EventTarget | null): boolean {
    const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>("a") : null;
    if (!anchor) return false;
    const destination = new URL(anchor.href, this.pageWindow.location.href);
    return destination.hostname === "chat.deepseek.com" &&
      destination.pathname.startsWith("/a/chat/s/") &&
      destination.href !== this.pageWindow.location.href;
  }

  /** 从 `/a/chat/s/{id}` 返回当前 DeepSeek 会话 ID；不在已打开的会话中时返回 null。 */
  getCurrentSessionId(): string | null {
    const match = this.pageWindow.location.pathname.match(/^\/a\/chat\/s\/([^/?#]+)$/u);
    return match?.[1] ?? null;
  }

  /** 返回当前页面是否为新对话输入界面。 */
  isNewConversation(): boolean {
    return this.pageWindow.location.pathname === "/";
  }

  /** 返回事件目标是否为已验证的原生输入框。 */
  isComposerTarget(target: EventTarget | null): boolean {
    return target === this.getComposer();
  }

  /** 捕获最新渲染的 Assistant 节点，避免虚拟列表复用掩盖新回答。 */
  captureAssistantCursor(): object | null {
    const answers = this.getAssistantAnswerCandidates();
    return answers.at(-1) ?? null;
  }

  /** 通过原生 setter 替换输入框文本，并触发真实的 DeepSeek 发送控件。 */
  async sendMessage(message: string): Promise<void> {
    const composer = this.getComposer();
    if (!composer || !this.getSendControl()) throw new Error("无法确认 DeepSeek 输入框或发送按钮。");

    const previousValue = composer.value;
    composer.focus();
    this.setComposerValue(composer, message);
    try {
      const sendControl = await this.waitForReadySendControl();
      sendControl.click();
    } catch (error) {
      const currentComposer = this.getComposer();
      if (currentComposer && (currentComposer.value === message || currentComposer.value === "")) {
        this.setComposerValue(currentComposer, previousValue);
      }
      throw error;
    }
  }

  /** 等待一个新的 Assistant 最终回答、生成完成且文本稳定。 */
  async waitForAssistantAnswer(
    previousAssistantCursor: object | null,
    optionsOrSignal: WaitForAnswerOptions | AbortSignal = {}
  ): Promise<string> {
    const options = isAbortSignal(optionsOrSignal) ? { signal: optionsOrSignal } : optionsOrSignal;
    const timeoutMs = options.timeoutMs ?? 120_000;
    const pollIntervalMs = options.pollIntervalMs ?? 400;
    const stableChecks = options.stableChecks ?? 2;
    const deadline = Date.now() + timeoutMs;
    let previousText = "";
    let stableCount = 0;

    while (Date.now() < deadline) {
      options.signal?.throwIfAborted();
      if (!this.getMessageList()) {
        await abortableDelay(this.pageWindow, pollIntervalMs, options.signal);
        continue;
      }
      const latest = this.getAssistantAnswerCandidates().at(-1) ?? null;
      const text = latest ? extractAssistantAnswer(latest) : "";
      const hasNewAnswer = Boolean(latest && latest !== previousAssistantCursor);
      const generationEnded = this.getSendControl()?.classList.contains("ds-button--disabled") ?? false;

      if (hasNewAnswer && text) {
        stableCount = text === previousText ? stableCount + 1 : 1;
        previousText = text;
        if (generationEnded || stableCount >= stableChecks) return text;
      } else {
        stableCount = 0;
        previousText = text;
      }
      await abortableDelay(this.pageWindow, pollIntervalMs, options.signal);
    }
    if (!this.getMessageList()) throw new Error("无法确认 DeepSeek 当前会话消息列表。");
    throw new Error("等待 DeepSeek 最终回答超时。");
  }

  /** 在输入框旁显示固定且不会引发布局偏移的状态。 */
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
    if (tone === "error" && !this.isProductionBuild) return;
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

  private clearStatusTimer(): void {
    if (this.statusTimeout === null) return;
    this.pageWindow.clearTimeout(this.statusTimeout);
    this.statusTimeout = null;
  }

  private getComposer(): HTMLTextAreaElement | null {
    return this.pageDocument.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR);
  }

  private setComposerValue(composer: HTMLTextAreaElement, value: string): void {
    const textareaConstructor = composer.ownerDocument.defaultView?.HTMLTextAreaElement;
    const valueSetter = textareaConstructor
      ? Object.getOwnPropertyDescriptor(textareaConstructor.prototype, "value")?.set
      : undefined;
    if (!valueSetter) throw new Error("无法设置 DeepSeek 输入框内容。");
    valueSetter.call(composer, value);
    composer.dispatchEvent(createComposerInputEvent(composer));
  }

  private async waitForReadySendControl(): Promise<HTMLElement> {
    const deadline = Date.now() + SEND_READY_TIMEOUT_MS;
    do {
      await nextAnimationFrame(this.pageWindow);
      const sendControl = this.getSendControl();
      if (sendControl && !sendControl.classList.contains("ds-button--disabled")) return sendControl;
      await abortableDelay(this.pageWindow, SEND_READY_POLL_MS);
    } while (Date.now() < deadline);
    throw new Error("DeepSeek 发送按钮未提交消息。");
  }

  private getComposerScope(): HTMLElement | null {
    let scope: HTMLElement | null = this.getComposer();
    for (let depth = 0; depth < 4 && scope; depth += 1) scope = scope.parentElement;
    return scope;
  }

  private getSendControl(): HTMLElement | null {
    const controls = this.getComposerScope()?.querySelectorAll<HTMLElement>('[role="button"]');
    if (!controls?.length) return null;
    return controls.item(controls.length - 1);
  }

  private getMessageList(): HTMLElement | null {
    return this.pageDocument.querySelector<HTMLElement>(MESSAGE_LIST_SELECTOR);
  }

  private getAssistantAnswerCandidates(): HTMLElement[] {
    const list = this.getMessageList();
    if (!list) return [];
    const observedAnswers = Array.from(list.querySelectorAll<HTMLElement>(ASSISTANT_CONTENT_SELECTOR));
    if (observedAnswers.length > 0) return observedAnswers;
    return Array.from(list.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement)
      .filter((child) => Boolean((child.innerText ?? child.textContent ?? "").trim()));
  }
}

// 重建渲染后的 Markdown 围栏，使协议解析不依赖 DeepSeek 的工具栏文本。
function extractAssistantAnswer(answer: HTMLElement): string {
  const sections = Array.from(answer.children, (child) => {
    if (child instanceof HTMLElement && child.matches(".md-code-block")) {
      const label = extractCodeBlockLabel(child);
      const content = child.querySelector("pre")?.textContent ?? "";
      const fence = markdownFenceFor(content);
      return `${fence}${label}\n${content}\n${fence}`;
    }
    return child instanceof HTMLElement ? (child.innerText ?? child.textContent ?? "").trim() : child.textContent?.trim() ?? "";
  }).filter(Boolean);
  if (sections.length > 0) return sections.join("\n\n").trim();
  return (answer.innerText ?? answer.textContent ?? "").trim();
}

function extractCodeBlockLabel(block: HTMLElement): string {
  const banner = block.querySelector<HTMLElement>(".md-code-block-banner");
  if (!banner) return "";
  const clone = banner.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[role="button"], button, svg').forEach((element) => element.remove());
  return (clone.innerText ?? clone.textContent ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function markdownFenceFor(content: string): string {
  const longestRun = Math.max(0, ...Array.from(content.matchAll(/`+/gu), (match) => match[0].length));
  return "`".repeat(Math.max(3, longestRun + 1));
}

function isAbortSignal(value: WaitForAnswerOptions | AbortSignal): value is AbortSignal {
  return "aborted" in value && "addEventListener" in value;
}

function createComposerInputEvent(composer: HTMLTextAreaElement): Event {
  const view = composer.ownerDocument.defaultView;
  if (view?.Event) return new view.Event("input", { bubbles: true });
  throw new Error("无法创建 DeepSeek 输入事件。");
}

function nextAnimationFrame(pageWindow: Window): Promise<void> {
  return new Promise((resolve) => {
    pageWindow.requestAnimationFrame(() => resolve());
  });
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
