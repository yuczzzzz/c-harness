import { DeepSeekSiteAdapter } from "@/deepseek/site-adapter";
import { deepSeekSessionToolKnowledgeStore } from "@/deepseek/session-tool-knowledge-store";
import { installSiteContentRuntime } from "@/content/runtime";
import { requestLegacyProjectBindingDatabaseDeletion } from "@/session-knowledge/legacy-project-database";
import { PageTaskCoordinator } from "@/tasks/page-task-coordinator";

/** 为当前页面安装 DeepSeek 增强运行时。 */
export function installDeepSeekContentRuntime(pageDocument: Document = document): PageTaskCoordinator {
  requestLegacyProjectBindingDatabaseDeletion("c-harness-project-bindings", pageDocument.defaultView?.indexedDB ?? indexedDB);
  return installSiteContentRuntime(
    new DeepSeekSiteAdapter(pageDocument, pageDocument.defaultView ?? window),
    deepSeekSessionToolKnowledgeStore,
    pageDocument
  );
}
