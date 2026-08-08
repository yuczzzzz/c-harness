import {
  callMcpTool,
  commitMcpSessionDisclosures,
  commitMcpSessionTrust,
  hasMcpSessionTrust,
  loadCatalog,
  loadMcpDetailsBatch,
  loadMcpServiceCatalog,
  loadMcpSessionDisclosures,
  loadCurrentOperatingSystem,
  loadProgressiveReferenceBatch,
  loadGeneralSettings,
  loadReferenceBatch,
  loadSkillBatch,
  RuntimeSkillProvider
} from "@/runtime/client";
import { confirmMcpToolCall } from "@/mcp/confirm";
import {
  applySessionKnowledgeResources,
  cloneSessionToolKnowledgeState,
  emptySessionToolKnowledgeState,
  type SessionKnowledgeResource,
  type SessionToolKnowledgeState
} from "@/session-knowledge/state";
import type { SessionToolKnowledgeStore } from "@/session-knowledge/store";
import { PageTaskCoordinator, type SiteTaskPort } from "@/tasks/page-task-coordinator";

/** 基于一个网站专用适配器安装共享页面任务运行时。 */
export function installSiteContentRuntime(
  adapter: SiteTaskPort & { readonly siteName: string },
  knowledgeStore: SessionToolKnowledgeStore,
  pageDocument: Document = document
): PageTaskCoordinator {
  const pageWindow = pageDocument.defaultView ?? window;
  let temporaryKnowledge = emptySessionToolKnowledgeState();

  const waitForOpenedSessionId = async (): Promise<string> => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const sessionId = adapter.getCurrentSessionId?.();
      if (sessionId) return sessionId;
      await new Promise((resolve) => pageWindow.setTimeout(resolve, 100));
    }
    throw new Error(`发送后没有进入合法 ${adapter.siteName} 会话 URL，会话知识绑定失败。`);
  };

  const loadCurrentKnowledge = async (): Promise<SessionToolKnowledgeState> => {
    const sessionId = adapter.getCurrentSessionId?.();
    if (sessionId) return await knowledgeStore.loadSessionToolKnowledgeState(sessionId, new RuntimeSkillProvider());
    temporaryKnowledge = emptySessionToolKnowledgeState();
    return cloneSessionToolKnowledgeState(temporaryKnowledge);
  };

  const bindTemporaryKnowledgeAfterFirstSend = async (): Promise<void> => {
    const sessionId = adapter.getCurrentSessionId?.() ?? await waitForOpenedSessionId();
    await knowledgeStore.bindTemporarySessionToolKnowledgeState(sessionId, temporaryKnowledge);
    temporaryKnowledge = emptySessionToolKnowledgeState();
  };

  const commitKnowledge = async (resources: SessionKnowledgeResource[]): Promise<void> => {
    const sessionId = adapter.getCurrentSessionId?.();
    if (sessionId) {
      await knowledgeStore.saveSessionKnowledgeResources(sessionId, resources);
      return;
    }
    applySessionKnowledgeResources(temporaryKnowledge, resources);
  };

  const coordinator = new PageTaskCoordinator(
    adapter,
    loadCatalog,
    loadSkillBatch,
    loadReferenceBatch,
    pageDocument,
    {
      mcp: {
        loadCatalog: loadMcpServiceCatalog,
        loadDisclosures: loadMcpSessionDisclosures,
        loadDetailsBatch: loadMcpDetailsBatch,
        commitDisclosures: commitMcpSessionDisclosures,
        hasSessionTrust: hasMcpSessionTrust,
        confirmToolCall: async (request) => await confirmMcpToolCall(request, pageDocument),
        commitSessionTrust: commitMcpSessionTrust,
        callTool: async (sessionId, request) => await callMcpTool(
          sessionId,
          request.serviceId,
          request.toolName,
          request.arguments
        )
      },
      afterInitialSend: async () => await bindTemporaryKnowledgeAfterFirstSend(),
      loadSettings: loadGeneralSettings,
      loadOperatingSystem: loadCurrentOperatingSystem,
      progressiveKnowledge: {
        loadInitialState: async () => await loadCurrentKnowledge(),
        onFeedbackCommitted: async (resources) => await commitKnowledge(resources),
        loadReferenceBatch: loadProgressiveReferenceBatch
      }
    }
  );
  coordinator.install();
  return coordinator;
}
