import { installSiteContentRuntime } from "@/content/runtime";
import { requestLegacyProjectBindingDatabaseDeletion } from "@/session-knowledge/legacy-project-database";
import { PageTaskCoordinator } from "@/tasks/page-task-coordinator";
import { ZaiSiteAdapter } from "@/zai/site-adapter";
import { zaiSessionToolKnowledgeStore } from "@/zai/session-tool-knowledge-store";

/** 为当前页面安装 z.ai 增强运行时。 */
export function installZaiContentRuntime(pageDocument: Document = document): PageTaskCoordinator {
  requestLegacyProjectBindingDatabaseDeletion("c-harness-zai-project-bindings", pageDocument.defaultView?.indexedDB ?? indexedDB);
  return installSiteContentRuntime(
    new ZaiSiteAdapter(pageDocument, pageDocument.defaultView ?? window),
    zaiSessionToolKnowledgeStore,
    pageDocument
  );
}
