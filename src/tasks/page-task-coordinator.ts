import { buildInitialHarness } from "@/harness/initial";
import {
  formatBatchCorrection,
  formatFinalAnswerCorrection,
  formatProgressiveBatchCorrection,
  formatReferenceBatch,
  formatSkillBatch,
  parseCommandBatch
} from "@/harness/commands";
import type { McpServiceCatalogItem, McpServiceDetails, McpSessionDisclosure, McpToolCallRequest, McpToolCallResult } from "@/mcp/contracts";
import { formatMcpCorrection, formatMcpDetailsBatch, formatMcpToolCallResult } from "@/mcp/format";
import { McpTaskCoordinator, type McpToolCallDecision } from "@/mcp/task-coordinator";
import type { ReferenceReadResult, SkillMetadata, SkillReadResult } from "@/skills/contracts";
import type { TaskState } from "@/tasks/contracts";
import { SKILL_DISABLED_MESSAGE, type GeneralSettings } from "@/settings/store";
import {
  applySessionKnowledgeResources,
  cloneSessionToolKnowledgeState,
  digestReferenceReads,
  digestSkillReads,
  type SessionKnowledgeResource,
  type SessionToolKnowledgeState
} from "@/session-knowledge/state";

export interface SiteTaskPort {
  readComposer(): string | null;
  isComposerTarget(target: EventTarget | null): boolean;
  isSendControl(target: EventTarget | null): boolean;
  isStopControl(target: EventTarget | null): boolean;
  isConversationNavigation(target: EventTarget | null): boolean;
  captureAssistantCursor(): object | null;
  getCurrentSessionId?(): string | null;
  sendMessage(message: string): void | Promise<void>;
  waitForAssistantAnswer(
    previousAssistantCursor: object | null,
    optionsOrSignal?: AbortSignal | { signal?: AbortSignal }
  ): Promise<string>;
  showStatus(message: string, tone?: "active" | "success" | "error"): void;
  dispose(): void;
}

export type CatalogLoader = () => Promise<SkillMetadata[]>;
export type SkillBatchLoader = (skillNames: string[]) => Promise<SkillReadResult[]>;
export type ReferenceBatchLoader = (
  virtualPaths: string[],
  selectedSkillNames: string[]
) => Promise<ReferenceReadResult[]>;

export interface PageTaskCoordinatorHooks {
  handleQuestion?: (question: string) => boolean | Promise<boolean>;
  shouldInterceptQuestion?: (question: string) => boolean | Promise<boolean>;
  afterInitialSend?: (question: string) => Promise<void>;
  isCustomTaskActive?: () => boolean;
  onStopControlClick?: () => void;
  onConversationNavigation?: () => void;
  progressiveKnowledge?: DeepSeekProgressiveKnowledgeStrategy;
  mcp?: McpPageTaskStrategy;
  loadSettings?: () => Promise<GeneralSettings>;
  random?: () => number;
}

export interface DeepSeekProgressiveKnowledgeStrategy {
  loadInitialState(): Promise<SessionToolKnowledgeState>;
  onFeedbackCommitted(resources: SessionKnowledgeResource[]): Promise<void>;
  loadReferenceBatch?: ReferenceBatchLoader;
}

export interface McpPageTaskStrategy {
  loadCatalog(): Promise<McpServiceCatalogItem[]>;
  loadDisclosures(sessionId: string): Promise<McpSessionDisclosure[]>;
  loadDetailsBatch(serviceIds: string[]): Promise<Array<{ serviceId: string; details: McpServiceDetails }>>;
  commitDisclosures(sessionId: string, serviceIds: string[]): Promise<void>;
  hasSessionTrust?(sessionId: string, serviceId: string): Promise<boolean>;
  confirmToolCall?(request: McpToolCallRequest): Promise<McpToolCallDecision>;
  commitSessionTrust?(sessionId: string, serviceId: string): Promise<void>;
  callTool?(sessionId: string, request: McpToolCallRequest): Promise<McpToolCallResult>;
}

/** 协调一个内存中的增强任务，并拦截当前页面上的用户发送操作。 */
export class PageTaskCoordinator {
  private state: TaskState | null = null;
  private internalSend = false;
  private installed = false;
  private waitingRunId: number | null = null;
  private runId = 0;
  private abortController: AbortController | null = null;
  private reinjectionTimer: number | null = null;

  constructor(
    private readonly adapter: SiteTaskPort,
    private readonly loadCatalog: CatalogLoader,
    private readonly loadSkillBatch: SkillBatchLoader,
    private readonly loadReferenceBatch: ReferenceBatchLoader,
    private readonly pageDocument: Document = document,
    private readonly hooks: PageTaskCoordinatorHooks = {}
  ) {}

  get currentState(): TaskState | null {
    return this.state;
  }

  /** 发送扩展自有消息，同时抑制协调器拦截用户发送操作产生的副作用。 */
  async sendInternalMessage(message: string): Promise<void> {
    await this.sendInternal(message);
  }

  /** 为回车、发送、停止和对话导航安装捕获阶段拦截。 */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    this.pageDocument.addEventListener("keydown", this.onKeyDown, true);
    this.pageDocument.addEventListener("click", this.onClick, true);
  }

  /** 抑制网站原始发送操作后，为原始问题启动增强流程。 */
  async startQuestion(question: string): Promise<void> {
    if (this.isActive()) {
      this.adapter.showStatus("当前增强任务尚未结束。", "error");
      return;
    }
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) return;

    const currentRunId = ++this.runId;
    const abortController = new AbortController();
    this.abortController = abortController;
    this.state = "awaiting_skill_selection";
    try {
      // 步骤 1：读取当前目录，并发送一次可见 Harness。
      const sessionId = this.adapter.getCurrentSessionId?.();
      const settings = await (this.hooks.loadSettings?.() ?? Promise.resolve({
        skillEnabled: true,
        reinjectionDelayMinSeconds: 1,
        reinjectionDelayMaxSeconds: 3
      }));
      const skillEnabled = settings.skillEnabled;
      const [catalog, initialKnowledge, mcpCatalog, mcpDisclosures] = await Promise.all([
        skillEnabled ? this.loadCatalog() : Promise.resolve([]),
        skillEnabled ? this.hooks.progressiveKnowledge?.loadInitialState() : Promise.resolve(undefined),
        this.hooks.mcp?.loadCatalog() ?? Promise.resolve([]),
        this.hooks.mcp && sessionId
          ? this.hooks.mcp.loadDisclosures(sessionId)
          : Promise.resolve([])
      ]);
      this.assertCurrentRun(currentRunId);
      let cursor = this.adapter.captureAssistantCursor();
      await this.sendInternal(buildInitialHarness(catalog, normalizedQuestion, initialKnowledge, mcpCatalog, mcpDisclosures, { skillEnabled }));
      if (skillEnabled) await this.hooks.afterInitialSend?.(normalizedQuestion);
      this.assertCurrentRun(currentRunId);

      if (!skillEnabled) {
        await this.resolveMcpOnlyStage(currentRunId, cursor, abortController.signal);
        return this.complete();
      }

      if (this.hooks.progressiveKnowledge && initialKnowledge) {
        await this.resolveProgressiveKnowledge(
          currentRunId,
          cursor,
          abortController.signal,
          cloneSessionToolKnowledgeState(initialKnowledge),
          this.hooks.progressiveKnowledge
        );
        return this.complete();
      }

      // 步骤 2：处理 Skill 阶段，并提供一次全批次纠正机会。
      const skillStage = await this.resolveSkillStage(currentRunId, cursor, abortController.signal);
      if (!skillStage) return this.complete();

      // 步骤 3：处理独立的 Reference 阶段，该阶段也可以提前完成。
      this.state = "awaiting_reference_selection";
      const referenceStage = await this.resolveReferenceStage(
        currentRunId,
        skillStage.nextCursor,
        skillStage.selectedSkillNames,
        abortController.signal
      );
      if (!referenceStage) return this.complete();

      // 步骤 4：要求给出不含命令的最终回答，仅允许一次固定提醒。
      this.state = "awaiting_final_answer";
      await this.resolveFinalStage(currentRunId, referenceStage.nextCursor, abortController.signal);
      this.complete();
    } catch (error) {
      if (currentRunId !== this.runId) return;
      this.state = "failed";
      this.adapter.showStatus(toErrorMessage(error), "error");
    } finally {
      if (currentRunId === this.runId) this.abortController = null;
    }
  }

  /** 移除页面监听器并取消活动的内存任务，不执行重放。 */
  dispose(): void {
    this.cancelActive();
    if (this.installed) {
      this.pageDocument.removeEventListener("keydown", this.onKeyDown, true);
      this.pageDocument.removeEventListener("click", this.onClick, true);
      this.installed = false;
    }
    this.adapter.dispose();
  }

  private async resolveSkillStage(
    runId: number,
    initialCursor: object | null,
    signal: AbortSignal
  ): Promise<{ selectedSkillNames: string[]; nextCursor: object | null } | null> {
    let cursor = initialCursor;
    let mcpCorrectionUsed = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const answer = await this.waitForAnswer(runId, cursor, signal);
      this.assertCurrentRun(runId);
      const batch = parseCommandBatch(answer);
      if (batch.kind === "none") return null;
      if (batch.kind === "mcp") {
        try {
          cursor = await this.resolveMcpDetails(runId, batch.requests, signal);
        } catch (error) {
          if (mcpCorrectionUsed) throw error;
          mcpCorrectionUsed = true;
          cursor = this.adapter.captureAssistantCursor();
          await this.sendReinjection(formatMcpCorrection(errorMessage(error)), signal);
        }
        continue;
      }
      if (batch.kind === "mcp-call") {
        try {
          cursor = await this.resolveMcpToolCall(runId, batch.request, signal);
        } catch (error) {
          if (mcpCorrectionUsed) throw error;
          mcpCorrectionUsed = true;
          cursor = this.adapter.captureAssistantCursor();
          await this.sendReinjection(formatMcpCorrection(errorMessage(error)), signal);
        }
        continue;
      }
      try {
        if (batch.kind !== "skill") throw new Error(skillBatchError(batch.kind));
        const results = await this.loadSkillBatch(batch.requests);
        this.assertCurrentRun(runId);
        const nextCursor = this.adapter.captureAssistantCursor();
        await this.sendReinjection(formatSkillBatch(results), signal);
        return { selectedSkillNames: batch.requests, nextCursor };
      } catch (error) {
        if (attempt > 0) throw error;
        cursor = this.adapter.captureAssistantCursor();
        await this.sendReinjection(formatBatchCorrection("skill", errorMessage(error)), signal);
      }
    }
    throw new Error("网页大模型返回了无效的 Skill 请求批次。");
  }

  private async resolveMcpOnlyStage(
    runId: number,
    initialCursor: object | null,
    signal: AbortSignal
  ): Promise<void> {
    let cursor = initialCursor;
    let correctionUsed = false;
    while (true) {
      const answer = await this.waitForAnswer(runId, cursor, signal);
      this.assertCurrentRun(runId);
      const batch = parseCommandBatch(answer);
      if (batch.kind === "none") return;
      if (batch.kind === "mcp") {
        try {
          cursor = await this.resolveMcpDetails(runId, batch.requests, signal);
        } catch (error) {
          if (correctionUsed) throw error;
          correctionUsed = true;
          cursor = this.adapter.captureAssistantCursor();
          await this.sendReinjection(formatMcpCorrection(errorMessage(error)), signal);
        }
        continue;
      }
      if (batch.kind === "mcp-call") {
        try {
          cursor = await this.resolveMcpToolCall(runId, batch.request, signal);
        } catch (error) {
          if (correctionUsed) throw error;
          correctionUsed = true;
          cursor = this.adapter.captureAssistantCursor();
          await this.sendReinjection(formatMcpCorrection(errorMessage(error)), signal);
        }
        continue;
      }
      if (batch.kind === "invalid") {
        if (correctionUsed) throw new Error(`网页大模型连续返回了无效的 MCP 请求批次：${batch.code}`);
        correctionUsed = true;
        cursor = this.adapter.captureAssistantCursor();
        await this.sendReinjection(formatMcpCorrection(`请求批次错误：${batch.code}`), signal);
        continue;
      }
      if (correctionUsed) throw new Error(SKILL_DISABLED_MESSAGE);
      correctionUsed = true;
      cursor = this.adapter.captureAssistantCursor();
      await this.sendReinjection(formatBatchCorrection(batch.kind === "read" ? "read" : "skill", SKILL_DISABLED_MESSAGE), signal);
    }
  }

  private async resolveReferenceStage(
    runId: number,
    initialCursor: object | null,
    selectedSkillNames: string[],
    signal: AbortSignal
  ): Promise<{ nextCursor: object | null } | null> {
    let cursor = initialCursor;
    let mcpCorrectionUsed = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const answer = await this.waitForAnswer(runId, cursor, signal);
      this.assertCurrentRun(runId);
      const batch = parseCommandBatch(answer);
      if (batch.kind === "none") return null;
      if (batch.kind === "mcp") {
        try {
          cursor = await this.resolveMcpDetails(runId, batch.requests, signal);
        } catch (error) {
          if (mcpCorrectionUsed) throw error;
          mcpCorrectionUsed = true;
          cursor = this.adapter.captureAssistantCursor();
          await this.sendReinjection(formatMcpCorrection(errorMessage(error)), signal);
        }
        continue;
      }
      if (batch.kind === "mcp-call") {
        try {
          cursor = await this.resolveMcpToolCall(runId, batch.request, signal);
        } catch (error) {
          if (mcpCorrectionUsed) throw error;
          mcpCorrectionUsed = true;
          cursor = this.adapter.captureAssistantCursor();
          await this.sendReinjection(formatMcpCorrection(errorMessage(error)), signal);
        }
        continue;
      }
      try {
        if (batch.kind !== "read") throw new Error(referenceBatchError(batch.kind));
        const results = await this.loadReferenceBatch(batch.requests, selectedSkillNames);
        this.assertCurrentRun(runId);
        const nextCursor = this.adapter.captureAssistantCursor();
        await this.sendReinjection(formatReferenceBatch(results), signal);
        return { nextCursor };
      } catch (error) {
        if (attempt > 0) throw error;
        cursor = this.adapter.captureAssistantCursor();
        await this.sendReinjection(formatBatchCorrection("read", errorMessage(error)), signal);
      }
    }
    throw new Error("网页大模型返回了无效的 Reference 请求批次。");
  }

  private async resolveFinalStage(
    runId: number,
    initialCursor: object | null,
    signal: AbortSignal
  ): Promise<void> {
    let cursor = initialCursor;
    let mcpCorrectionUsed = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const answer = await this.waitForAnswer(runId, cursor, signal);
      this.assertCurrentRun(runId);
      const batch = parseCommandBatch(answer);
      if (batch.kind === "none") return;
      if (batch.kind === "mcp") {
        try {
          cursor = await this.resolveMcpDetails(runId, batch.requests, signal);
        } catch (error) {
          if (mcpCorrectionUsed) throw error;
          mcpCorrectionUsed = true;
          cursor = this.adapter.captureAssistantCursor();
          await this.sendReinjection(formatMcpCorrection(errorMessage(error)), signal);
        }
        continue;
      }
      if (batch.kind === "mcp-call") {
        try {
          cursor = await this.resolveMcpToolCall(runId, batch.request, signal);
        } catch (error) {
          if (mcpCorrectionUsed) throw error;
          mcpCorrectionUsed = true;
          cursor = this.adapter.captureAssistantCursor();
          await this.sendReinjection(formatMcpCorrection(errorMessage(error)), signal);
        }
        continue;
      }
      if (attempt > 0) throw new Error("Reference 回注后不再允许新的读取请求。");
      cursor = this.adapter.captureAssistantCursor();
      await this.sendReinjection(formatFinalAnswerCorrection(), signal);
    }
  }

  private async resolveProgressiveKnowledge(
    runId: number,
    initialCursor: object | null,
    signal: AbortSignal,
    knowledge: SessionToolKnowledgeState,
    strategy: DeepSeekProgressiveKnowledgeStrategy
  ): Promise<void> {
    let cursor = initialCursor;
    const correctionUsed = { skill: false, read: false };
    let mcpCorrectionUsed = false;
    let invalidCorrectionUsed = false;
    while (true) {
      const answer = await this.waitForAnswer(runId, cursor, signal);
      this.assertCurrentRun(runId);
      const batch = parseCommandBatch(answer);
      if (batch.kind === "none") return;
      if (batch.kind === "invalid") {
        if (invalidCorrectionUsed) throw new Error("网页大模型连续返回了无效的读取请求批次。");
        invalidCorrectionUsed = true;
        cursor = this.adapter.captureAssistantCursor();
        await this.sendReinjection(formatProgressiveBatchCorrection(`请求批次错误：${batch.code}`), signal);
        continue;
      }
      const kind = batch.kind;
      if (kind === "mcp") {
        try {
          cursor = await this.resolveMcpDetails(runId, batch.requests, signal);
        } catch (error) {
          if (mcpCorrectionUsed) throw error;
          mcpCorrectionUsed = true;
          cursor = this.adapter.captureAssistantCursor();
          await this.sendReinjection(formatMcpCorrection(errorMessage(error)), signal);
        }
        continue;
      }
      if (kind === "mcp-call") {
        try {
          cursor = await this.resolveMcpToolCall(runId, batch.request, signal);
        } catch (error) {
          if (mcpCorrectionUsed) throw error;
          mcpCorrectionUsed = true;
          cursor = this.adapter.captureAssistantCursor();
          await this.sendReinjection(formatMcpCorrection(errorMessage(error)), signal);
        }
        continue;
      }
      let results: SkillReadResult[] | ReferenceReadResult[];
      try {
        this.state = kind === "skill" ? "awaiting_skill_selection" : "awaiting_reference_selection";
        results = kind === "skill"
          ? await this.loadSkillBatch(batch.requests)
          : await (strategy.loadReferenceBatch ?? this.loadReferenceBatch)(
            batch.requests,
            Array.from(knowledge.skills.keys())
          );
      } catch (error) {
        if (correctionUsed[kind]) throw error;
        correctionUsed[kind] = true;
        cursor = this.adapter.captureAssistantCursor();
        await this.sendReinjection(formatBatchCorrection(kind, errorMessage(error)), signal);
        continue;
      }
      this.assertCurrentRun(runId);
      const resources = kind === "skill"
        ? await digestSkillReads(results as SkillReadResult[])
        : await digestReferenceReads(results as ReferenceReadResult[]);
      applySessionKnowledgeResources(knowledge, resources);
      cursor = this.adapter.captureAssistantCursor();
      await this.sendReinjection(kind === "skill"
        ? formatSkillBatch(results as SkillReadResult[])
        : formatReferenceBatch(results as ReferenceReadResult[]), signal);
      await strategy.onFeedbackCommitted(resources);
      this.assertCurrentRun(runId);
    }
  }

  private async resolveMcpDetails(runId: number, serviceIds: string[], signal: AbortSignal): Promise<object | null> {
    if (!this.hooks.mcp) throw new Error("当前页面不能读取 MCP 服务详情。");
    const sessionId = this.adapter.getCurrentSessionId?.();
    if (!sessionId) throw new Error("当前会话尚未建立，不能记录 MCP 详情披露。");
    const details = await this.hooks.mcp.loadDetailsBatch(serviceIds);
    const output = {
      message: formatMcpDetailsBatch(details),
      serviceIds: details.map((item) => item.serviceId)
    };
    this.assertCurrentRun(runId);
    const nextCursor = this.adapter.captureAssistantCursor();
    await this.sendReinjection(output.message, signal);
    this.assertCurrentRun(runId);
    await this.hooks.mcp.commitDisclosures(sessionId, output.serviceIds);
    return nextCursor;
  }

  private async resolveMcpToolCall(runId: number, request: McpToolCallRequest, signal: AbortSignal): Promise<object | null> {
    if (!this.hooks.mcp) throw new Error("当前页面不能调用 MCP Tool。");
    if (!this.hooks.mcp.callTool) throw new Error("当前页面不能调用 MCP Tool。");
    const sessionId = this.adapter.getCurrentSessionId?.();
    if (!sessionId) throw new Error("当前会话尚未建立，不能调用 MCP Tool。");
    const coordinator = new McpTaskCoordinator({
      readDetailsBatch: async (requests) => await this.hooks.mcp!.loadDetailsBatch(requests),
      commitDisclosures: async (requests) => await this.hooks.mcp!.commitDisclosures(sessionId, requests),
      hasSessionTrust: async (serviceId) => await (this.hooks.mcp!.hasSessionTrust?.(sessionId, serviceId) ?? false),
      confirmToolCall: async (callRequest) => await (this.hooks.mcp!.confirmToolCall?.(callRequest) ?? "deny"),
      commitSessionTrust: async (serviceId) => await this.hooks.mcp!.commitSessionTrust?.(sessionId, serviceId),
      callTool: async (callRequest) => await this.hooks.mcp!.callTool!(sessionId, callRequest)
    });
    const outcome = await coordinator.callTool(request);
    this.assertCurrentRun(runId);
    const nextCursor = this.adapter.captureAssistantCursor();
    await this.sendReinjection(formatMcpToolCallResult(outcome.result), signal, { skipDelay: outcome.prompted });
    return nextCursor;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.isComposing ||
      !this.adapter.isComposerTarget(event.target)
    ) return;
    this.interceptHumanSend(event);
  };

  private readonly onClick = (event: MouseEvent): void => {
    if (this.internalSend) return;
    if (this.adapter.isConversationNavigation(event.target)) {
      this.hooks.onConversationNavigation?.();
      if (this.isActive()) this.cancelActive();
      return;
    }
    if ((this.isActive() || this.hooks.isCustomTaskActive?.() === true) && this.adapter.isStopControl(event.target)) {
      this.hooks.onStopControlClick?.();
      if (this.isActive()) this.cancelActive();
      return;
    }
    if (this.adapter.isSendControl(event.target)) this.interceptHumanSend(event);
  };

  private interceptHumanSend(event: Event): void {
    if (this.internalSend) return;
    const question = this.adapter.readComposer();
    if (!question?.trim()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void this.startInterceptedQuestion(question);
  }

  private async startInterceptedQuestion(question: string): Promise<void> {
    try {
      if (await this.hooks.handleQuestion?.(question) === true) return;
      if (await this.hooks.shouldInterceptQuestion?.(question) === false) {
        await this.sendInternal(question);
        return;
      }
      await this.startQuestion(question);
    } catch (error) {
      this.state = "failed";
      this.adapter.showStatus(toErrorMessage(error), "error");
    }
  }

  private async waitForAnswer(
    runId: number,
    cursor: object | null,
    signal: AbortSignal
  ): Promise<string> {
    this.waitingRunId = runId;
    try {
      return await this.adapter.waitForAssistantAnswer(cursor, signal);
    } finally {
      if (this.waitingRunId === runId) this.waitingRunId = null;
    }
  }

  private cancelActive(): void {
    if (!this.isActive()) return;
    this.runId += 1;
    this.state = "cancelled";
    this.waitingRunId = null;
    this.abortController?.abort(new Error("增强任务已取消。"));
    this.clearReinjectionTimer();
    this.abortController = null;
  }

  private complete(): void {
    this.state = "completed";
  }

  private isActive(): boolean {
    return this.state === "awaiting_skill_selection" ||
      this.state === "awaiting_reference_selection" ||
      this.state === "awaiting_final_answer";
  }

  private assertCurrentRun(runId: number): void {
    if (runId !== this.runId) throw new Error("增强任务已取消。");
  }

  private async sendInternal(message: string): Promise<void> {
    this.internalSend = true;
    try {
      await this.adapter.sendMessage(message);
    } finally {
      this.internalSend = false;
    }
  }

  private async sendReinjection(message: string, signal: AbortSignal, options: { skipDelay?: boolean } = {}): Promise<void> {
    if (!options.skipDelay && this.hooks.loadSettings) {
      const settings = await this.hooks.loadSettings();
      const delaySeconds = randomDelaySeconds(
        settings.reinjectionDelayMinSeconds,
        settings.reinjectionDelayMaxSeconds,
        this.hooks.random?.() ?? Math.random()
      );
      await this.waitForReinjectionDelay(delaySeconds, signal);
    }
    signal.throwIfAborted();
    await this.sendInternal(message);
  }

  private waitForReinjectionDelay(delaySeconds: number, signal: AbortSignal): Promise<void> {
    if (delaySeconds <= 0) return Promise.resolve();
    signal.throwIfAborted();
    const pageWindow = this.pageDocument.defaultView ?? window;
    return new Promise((resolve, reject) => {
      this.reinjectionTimer = pageWindow.setTimeout(() => {
        this.reinjectionTimer = null;
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, delaySeconds * 1000);
      const onAbort = (): void => {
        this.clearReinjectionTimer();
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private clearReinjectionTimer(): void {
    if (this.reinjectionTimer === null) return;
    const pageWindow = this.pageDocument.defaultView ?? window;
    pageWindow.clearTimeout(this.reinjectionTimer);
    this.reinjectionTimer = null;
  }
}

function randomDelaySeconds(minSeconds: number, maxSeconds: number, randomValue: number): number {
  const span = maxSeconds - minSeconds + 1;
  const normalized = Math.min(0.999999999999, Math.max(0, randomValue));
  return minSeconds + Math.floor(normalized * span);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知批次错误。";
}

function skillBatchError(kind: ReturnType<typeof parseCommandBatch>["kind"]): string {
  if (kind === "read") return "Skill 选择阶段不能请求 Reference。";
  if (kind === "mcp") return "MCP 详情已单独处理，请继续按当前阶段请求 Skill 或直接回答。";
  if (kind === "mcp-call") return "MCP Tool 调用已单独处理，请继续按当前阶段请求 Skill 或直接回答。";
  return "网页大模型返回了无效的 Skill 请求批次。";
}

function referenceBatchError(kind: ReturnType<typeof parseCommandBatch>["kind"]): string {
  if (kind === "skill") return "Reference 选择阶段不能再次请求 Skill。";
  if (kind === "mcp") return "MCP 详情已单独处理，请继续按当前阶段请求 Reference 或直接回答。";
  if (kind === "mcp-call") return "MCP Tool 调用已单独处理，请继续按当前阶段请求 Reference 或直接回答。";
  return "网页大模型返回了无效的 Reference 请求批次。";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? `增强失败：${error.message}` : "增强失败：未知错误。";
}
