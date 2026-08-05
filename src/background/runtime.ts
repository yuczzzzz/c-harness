import type { RuntimeRequest, RuntimeResponse } from "@/runtime/contracts";
import { callMcpEndpointTool, discoverMcpEndpoint } from "@/mcp/client";
import { MCP_LIMITS } from "@/mcp/contracts";
import { normalizeMcpEndpoint } from "@/mcp/endpoint";
import { hasMcpHostPermission, removeMcpHostPermission } from "@/mcp/permissions";
import {
  addMcpService,
  commitMcpSessionTrust,
  commitMcpSessionDisclosure,
  deleteMcpService,
  getMcpServiceById,
  hasCurrentMcpSessionDisclosure,
  hasCurrentMcpSessionTrust,
  hasOtherMcpServiceWithOrigin,
  listMcpServiceCatalog,
  listMcpSessionDisclosures,
  listMcpServices,
  markMcpServiceUnavailable,
  updateMcpServiceDetection
} from "@/mcp/store";
import { SKILL_LIMITS, type SkillPackage } from "@/skills/contracts";
import {
  deleteSkill,
  listSkills,
  readReferenceBatch,
  readProgressiveReferenceBatch,
  readSkillBatch,
  replaceSkill,
  resolveStoredReference,
  resolveStoredSkill
} from "@/skills/store";
import { isSafeSkillName, parseReferenceVirtualPath } from "@/skills/paths";
import { getGeneralSettings, SKILL_DISABLED_MESSAGE, updateReinjectionDelay, updateSkillEnabled } from "@/settings/store";

const TRUSTED_CHAT_URLS = [
  /^https:\/\/chat\.deepseek\.com(?:\/|$)/u,
  /^https:\/\/chat\.z\.ai(?:\/|$)/u
];

/** 安装面向请求的扩展运行时监听器。 */
export function installBackgroundRuntime(): () => void {
  const listener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: RuntimeResponse<unknown>) => void
  ): true => {
    void handleRuntimeRequest(message, sender).then(sendResponse);
    return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

/** 处理一个独立的运行时请求，不保留任务状态。 */
export async function handleRuntimeRequest(
  message: unknown,
  sender: chrome.runtime.MessageSender
): Promise<RuntimeResponse<unknown>> {
  try {
    if (!isRuntimeRequest(message)) return failure("不支持的扩展请求。");
    if (!isAllowedExtensionSender(sender)) return failure("请求来源不受信任。");

    switch (message.type) {
      case "settings.get":
        if (!isOptionsSender(sender) && !isTrustedChatSender(sender)) {
          return failure("当前页面不能读取通用设置。");
        }
        return { ok: true, data: await getGeneralSettings() };
      case "settings.skillEnabled.update":
        if (!isOptionsSender(sender)) return failure("只有扩展管理页可以修改通用设置。");
        return { ok: true, data: await updateSkillEnabled(message.skillEnabled) };
      case "settings.reinjectionDelay.update":
        if (!isOptionsSender(sender)) return failure("只有扩展管理页可以修改通用设置。");
        return { ok: true, data: await updateReinjectionDelay(message.minSeconds, message.maxSeconds) };
      case "catalog.get":
        if (!isOptionsSender(sender) && !isTrustedChatSender(sender)) {
          return failure("当前页面不能读取 Skill 目录。");
        }
        if (isTrustedChatSender(sender) && !(await getGeneralSettings()).skillEnabled) {
          return failure(SKILL_DISABLED_MESSAGE);
        }
        return { ok: true, data: await listSkills() };
      case "mcp.catalog.get":
        if (!isOptionsSender(sender)) return failure("只有扩展管理页可以读取 MCP 服务目录。");
        return { ok: true, data: await listMcpServices() };
      case "mcp.serviceCatalog.get":
        if (!isOptionsSender(sender) && !isTrustedChatSender(sender)) {
          return failure("当前页面不能读取 MCP 服务目录。");
        }
        return { ok: true, data: await listMcpServiceCatalog() };
      case "mcp.service.add":
        if (!isOptionsSender(sender)) return failure("只有扩展管理页可以添加 MCP 服务。");
        return { ok: true, data: await addMcpServiceFromEndpoint(message.endpoint) };
      case "mcp.service.redetect":
        if (!isOptionsSender(sender) || !isSafeMcpServiceId(message.serviceId)) {
          return failure("MCP 服务重新检测请求无效。");
        }
        return { ok: true, data: await redetectMcpService(message.serviceId) };
      case "mcp.service.delete":
        if (!isOptionsSender(sender) || !isSafeMcpServiceId(message.serviceId)) {
          return failure("MCP 服务删除请求无效。");
        }
        return { ok: true, data: await deleteMcpServiceAndPermission(message.serviceId) };
      case "mcp.details.readBatch":
        if (!isTrustedChatSender(sender) || !isValidMcpServiceIdBatch(message.serviceIds)) {
          return failure("MCP 详情读取请求无效。");
        }
        return { ok: true, data: await readMcpDetailsBatch(message.serviceIds) };
      case "mcp.session.disclosures.get":
        if (!isTrustedChatSender(sender) || !isSafeSessionId(message.sessionId)) {
          return failure("MCP 会话披露查询请求无效。");
        }
        return { ok: true, data: await listMcpSessionDisclosures(siteOriginFromSender(sender), message.sessionId) };
      case "mcp.session.disclosures.commit":
        if (
          !isTrustedChatSender(sender) ||
          !isSafeSessionId(message.sessionId) ||
          !isValidMcpServiceIdBatch(message.serviceIds)
        ) {
          return failure("MCP 会话披露提交请求无效。");
        }
        await commitMcpDisclosures(siteOriginFromSender(sender), message.sessionId, message.serviceIds);
        return { ok: true, data: undefined };
      case "mcp.session.trust.get":
        if (!isTrustedChatSender(sender) || !isSafeSessionId(message.sessionId) || !isSafeMcpServiceId(message.serviceId)) {
          return failure("MCP 会话信任查询请求无效。");
        }
        return { ok: true, data: await hasMcpTrust(siteOriginFromSender(sender), message.sessionId, message.serviceId) };
      case "mcp.session.trust.commit":
        if (!isTrustedChatSender(sender) || !isSafeSessionId(message.sessionId) || !isSafeMcpServiceId(message.serviceId)) {
          return failure("MCP 会话信任提交请求无效。");
        }
        await commitMcpTrust(siteOriginFromSender(sender), message.sessionId, message.serviceId);
        return { ok: true, data: undefined };
      case "mcp.tool.call":
        if (
          !isTrustedChatSender(sender) ||
          !isSafeSessionId(message.sessionId) ||
          !isSafeMcpServiceId(message.serviceId) ||
          !isSafeMcpToolName(message.toolName) ||
          !isValidMcpArguments(message.arguments)
        ) {
          return failure("MCP Tool 调用请求无效。");
        }
        return {
          ok: true,
          data: await callMcpToolForSession(
            siteOriginFromSender(sender),
            message.sessionId,
            message.serviceId,
            message.toolName,
            message.arguments
          )
        };
      case "skill.readBatch":
        if (!isTrustedChatSender(sender) || !isValidSkillNameBatch(message.skillNames)) {
          return failure("Skill 批量读取请求无效。");
        }
        if (!(await getGeneralSettings()).skillEnabled) return failure(SKILL_DISABLED_MESSAGE);
        return { ok: true, data: await readSkillBatch(message.skillNames) };
      case "reference.readBatch":
        if (
          !isTrustedChatSender(sender) ||
          !isValidReferenceBatch(message.selectedSkillNames, message.virtualPaths)
        ) {
          return failure("Reference 批量读取请求无效。");
        }
        if (!(await getGeneralSettings()).skillEnabled) return failure(SKILL_DISABLED_MESSAGE);
        return {
          ok: true,
          data: await readReferenceBatch(message.selectedSkillNames, message.virtualPaths)
        };
      case "reference.readProgressiveBatch":
        if (
          !isTrustedChatSender(sender) ||
          !isValidReferenceBatch(message.selectedSkillNames, message.virtualPaths)
        ) return failure("渐进 Reference 批量读取请求无效。");
        if (!(await getGeneralSettings()).skillEnabled) return failure(SKILL_DISABLED_MESSAGE);
        return { ok: true, data: await readProgressiveReferenceBatch(message.selectedSkillNames, message.virtualPaths) };
      case "skill.resolve":
        if (!isTrustedChatSender(sender) || !isSafeSkillName(message.skillName)) {
          return failure("Skill 解析请求无效。");
        }
        if (!(await getGeneralSettings()).skillEnabled) return failure(SKILL_DISABLED_MESSAGE);
        return { ok: true, data: await resolveStoredSkill(message.skillName) };
      case "reference.resolve":
        if (!isTrustedChatSender(sender) || !parseReferenceVirtualPath(message.virtualPath)) {
          return failure("Reference 解析请求无效。");
        }
        if (!(await getGeneralSettings()).skillEnabled) return failure(SKILL_DISABLED_MESSAGE);
        return { ok: true, data: await resolveStoredReference(message.virtualPath) };
      case "skill.replace":
        if (!isOptionsSender(sender)) return failure("只有扩展管理页可以保存 Skill。");
        if (!isValidSkillPackage(message.skillPackage)) return failure("Skill 包数据无效。");
        await replaceSkill(message.skillPackage);
        return { ok: true, data: undefined };
      case "skill.delete":
        if (!isOptionsSender(sender) || !isSafeSkillName(message.skillName)) {
          return failure("Skill 删除请求无效。");
        }
        await deleteSkill(message.skillName);
        return { ok: true, data: undefined };
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : "扩展请求失败。");
  }
}

function isAllowedExtensionSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id;
}

function isOptionsSender(sender: chrome.runtime.MessageSender): boolean {
  const optionsUrl = chrome.runtime.getURL("options.html");
  return sender.url === optionsUrl || Boolean(sender.url?.startsWith(`${optionsUrl}#`));
}

function isTrustedChatSender(sender: chrome.runtime.MessageSender): boolean {
  return typeof sender.tab?.id === "number" &&
    Boolean(sender.url && TRUSTED_CHAT_URLS.some((pattern) => pattern.test(sender.url!)));
}

function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "settings.get") return true;
  if (value.type === "settings.skillEnabled.update") return typeof value.skillEnabled === "boolean";
  if (value.type === "settings.reinjectionDelay.update") {
    return typeof value.minSeconds === "number" && typeof value.maxSeconds === "number";
  }
  if (value.type === "catalog.get") return true;
  if (value.type === "mcp.catalog.get") return true;
  if (value.type === "mcp.serviceCatalog.get") return true;
  if (value.type === "mcp.service.add") return typeof value.endpoint === "string";
  if (value.type === "mcp.service.redetect") return typeof value.serviceId === "string";
  if (value.type === "mcp.service.delete") return typeof value.serviceId === "string";
  if (value.type === "mcp.details.readBatch") return Array.isArray(value.serviceIds);
  if (value.type === "mcp.session.disclosures.get") return typeof value.sessionId === "string";
  if (value.type === "mcp.session.disclosures.commit") {
    return typeof value.sessionId === "string" && Array.isArray(value.serviceIds);
  }
  if (value.type === "mcp.session.trust.get") {
    return typeof value.sessionId === "string" && typeof value.serviceId === "string";
  }
  if (value.type === "mcp.session.trust.commit") {
    return typeof value.sessionId === "string" && typeof value.serviceId === "string";
  }
  if (value.type === "mcp.tool.call") {
    return typeof value.sessionId === "string" &&
      typeof value.serviceId === "string" &&
      typeof value.toolName === "string" &&
      "arguments" in value;
  }
  if (value.type === "skill.readBatch") return Array.isArray(value.skillNames);
  if (value.type === "reference.readBatch") {
    return Array.isArray(value.selectedSkillNames) && Array.isArray(value.virtualPaths);
  }
  if (value.type === "reference.readProgressiveBatch") {
    return Array.isArray(value.selectedSkillNames) && Array.isArray(value.virtualPaths);
  }
  if (value.type === "skill.resolve") return typeof value.skillName === "string";
  if (value.type === "reference.resolve") return typeof value.virtualPath === "string";
  if (value.type === "skill.replace") return "skillPackage" in value;
  if (value.type === "skill.delete") return typeof value.skillName === "string";
  return false;
}

async function addMcpServiceFromEndpoint(endpointInput: string) {
  const normalized = normalizeMcpEndpoint(endpointInput);
  if (!await hasMcpHostPermission(normalized.permissionOrigin)) {
    throw new Error("尚未授予该 MCP 服务的主机权限。");
  }
  const details = await discoverMcpEndpoint(normalized.endpoint);
  return addMcpService(normalized.endpoint, normalized.permissionOrigin, details);
}

async function redetectMcpService(serviceId: string) {
  const service = await getMcpServiceById(serviceId);
  if (!service) throw new Error("MCP 服务不存在。");
  try {
    if (!await hasMcpHostPermission(service.permissionOrigin)) {
      throw new Error("尚未授予该 MCP 服务的主机权限。");
    }
    const details = await discoverMcpEndpoint(service.endpoint);
    return updateMcpServiceDetection(serviceId, details);
  } catch (error) {
    await markMcpServiceUnavailable(serviceId);
    throw error;
  }
}

async function readMcpDetailsBatch(serviceIds: string[]) {
  const results = [];
  for (const serviceId of serviceIds) {
    const service = await getMcpServiceById(serviceId);
    if (!service) throw new Error(`MCP 服务「${serviceId}」不存在。`);
    const details = await discoverMcpEndpoint(service.endpoint);
    const current = service.detailSummary === details.detailSummary
      ? service
      : await updateMcpServiceDetection(serviceId, details);
    results.push({ serviceId: current.serviceId, details: { ...details, detailSummary: current.detailSummary } });
  }
  return results;
}

async function commitMcpDisclosures(siteOrigin: string, sessionId: string, serviceIds: string[]): Promise<void> {
  for (const serviceId of serviceIds) {
    const service = await getMcpServiceById(serviceId);
    if (!service) throw new Error(`MCP 服务「${serviceId}」不存在。`);
    await commitMcpSessionDisclosure(siteOrigin, sessionId, service);
  }
}

async function hasMcpTrust(siteOrigin: string, sessionId: string, serviceId: string): Promise<boolean> {
  const service = await getMcpServiceById(serviceId);
  if (!service) throw new Error(`MCP 服务「${serviceId}」不存在。`);
  return await hasCurrentMcpSessionTrust(siteOrigin, sessionId, service);
}

async function commitMcpTrust(siteOrigin: string, sessionId: string, serviceId: string): Promise<void> {
  const service = await getMcpServiceById(serviceId);
  if (!service) throw new Error(`MCP 服务「${serviceId}」不存在。`);
  if (!await hasCurrentMcpSessionDisclosure(siteOrigin, sessionId, service)) {
    throw new Error("当前会话尚未披露该 MCP 服务详情。");
  }
  await commitMcpSessionTrust(siteOrigin, sessionId, service);
}

async function callMcpToolForSession(
  siteOrigin: string,
  sessionId: string,
  serviceId: string,
  toolName: string,
  args: Record<string, unknown>
) {
  const service = await getMcpServiceById(serviceId);
  if (!service) throw new Error(`MCP 服务「${serviceId}」不存在。`);
  const details = await discoverMcpEndpoint(service.endpoint);
  const current = service.detailSummary === details.detailSummary
    ? service
    : await updateMcpServiceDetection(serviceId, details);
  if (current.detailSummary !== service.detailSummary) {
    throw new Error("MCP 服务详情已变化，请先重新读取该服务详情。");
  }
  if (!await hasCurrentMcpSessionDisclosure(siteOrigin, sessionId, current)) {
    throw new Error("当前会话尚未披露该 MCP 服务详情。");
  }
  if (!details.tools.some((tool) => tool.name === toolName)) {
    throw new Error(`MCP Tool「${toolName}」不存在。`);
  }
  return await callMcpEndpointTool(current.endpoint, current.serviceId, current.detailSummary, toolName, args);
}

async function deleteMcpServiceAndPermission(serviceId: string) {
  const deleted = await deleteMcpService(serviceId);
  if (!deleted) return null;
  if (!await hasOtherMcpServiceWithOrigin(deleted.permissionOrigin, deleted.serviceId)) {
    await removeMcpHostPermission(deleted.permissionOrigin);
  }
  return deleted;
}

function isSafeMcpServiceId(value: string): boolean {
  return /^[a-z0-9._-]{1,64}$/u.test(value);
}

function isSafeMcpToolName(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !value.includes("\0") && !value.includes("\n");
}

function isValidMcpArguments(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    !Array.isArray(value) &&
    new TextEncoder().encode(JSON.stringify(value)).byteLength <= MCP_LIMITS.maxCallArgumentsBytes;
}

function isValidMcpServiceIdBatch(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && isSafeMcpServiceId(item)) &&
    new Set(value).size === value.length;
}

function isSafeSessionId(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !value.includes("\0");
}

function siteOriginFromSender(sender: chrome.runtime.MessageSender): string {
  if (!sender.url) throw new Error("无法确认当前站点来源。");
  return new URL(sender.url).origin;
}

function isValidReferenceBatch(selectedSkillNames: unknown, virtualPaths: unknown): boolean {
  if (
    !Array.isArray(selectedSkillNames) ||
    selectedSkillNames.length === 0 ||
    !selectedSkillNames.every(isSafeSkillName) ||
    new Set(selectedSkillNames).size !== selectedSkillNames.length ||
    !Array.isArray(virtualPaths) ||
    virtualPaths.length === 0 ||
    !virtualPaths.every((path) => typeof path === "string") ||
    new Set(virtualPaths).size !== virtualPaths.length
  ) {
    return false;
  }
  const selected = new Set<string>(selectedSkillNames);
  return virtualPaths.every((path) => {
    const parsed = parseReferenceVirtualPath(path);
    return Boolean(parsed && selected.has(parsed.skillName));
  });
}

function isValidSkillNameBatch(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every(isSafeSkillName) &&
    new Set(value).size === value.length;
}

function isValidSkillPackage(value: unknown): value is SkillPackage {
  if (!isRecord(value) || !isRecord(value.metadata) || !Array.isArray(value.files)) return false;
  const metadata = value.metadata;
  if (
    !isSafeSkillName(metadata.name) ||
    typeof metadata.description !== "string" ||
    !metadata.description.trim() ||
    !isNonNegativeNumber(metadata.referenceCount) ||
    !isNonNegativeNumber(metadata.packageBytes) ||
    !isNonNegativeNumber(metadata.savedBytes) ||
    !isNonNegativeNumber(metadata.ignoredEntryCount) ||
    typeof metadata.importedAt !== "string"
  ) {
    return false;
  }
  const paths = new Set<string>();
  let skillFileCount = 0;
  let referenceCount = 0;
  let savedBytes = 0;
  const validFiles = value.files.every((file) => {
    if (!isRecord(file)) return false;
    if (
      file.skillName === metadata.name &&
      typeof file.virtualPath === "string" &&
      (file.virtualPath === "SKILL.md" || file.virtualPath.startsWith("references/")) &&
      (file.kind === "skill" || file.kind === "reference") &&
      typeof file.content === "string" &&
      isNonNegativeNumber(file.byteLength) &&
      file.byteLength <= SKILL_LIMITS.maxTextBytes &&
      !file.content.includes("\0") &&
      new TextEncoder().encode(file.content).byteLength === file.byteLength &&
      !paths.has(file.virtualPath)
    ) {
      paths.add(file.virtualPath);
      savedBytes += file.byteLength;
      if (file.kind === "skill" && file.virtualPath === "SKILL.md") skillFileCount += 1;
      else if (file.kind === "reference" && file.virtualPath.startsWith("references/")) referenceCount += 1;
      else return false;
      return true;
    }
    return false;
  });
  return (
    validFiles &&
    skillFileCount === 1 &&
    referenceCount === metadata.referenceCount &&
    savedBytes === metadata.savedBytes &&
    savedBytes <= SKILL_LIMITS.maxArchiveBytes
  );
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(error: string): RuntimeResponse<never> {
  return { ok: false, error };
}
