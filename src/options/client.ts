import type { RuntimeRequest, RuntimeResponse } from "@/runtime/contracts";
import type { McpServiceRecord } from "@/mcp/contracts";
import { normalizeMcpEndpoint } from "@/mcp/endpoint";
import { originToPermissionPattern } from "@/mcp/permissions";
import type { SkillMetadata, SkillPackage } from "@/skills/contracts";
import type { GeneralSettings } from "@/settings/store";

export interface SkillLibraryClient {
  getCatalog(): Promise<SkillMetadata[]>;
  replace(skillPackage: SkillPackage): Promise<void>;
  delete(skillName: string): Promise<void>;
}

export interface McpServiceClient {
  list(): Promise<McpServiceRecord[]>;
  add(endpoint: string): Promise<McpServiceRecord>;
  redetect(service: McpServiceRecord): Promise<McpServiceRecord>;
  delete(serviceId: string): Promise<McpServiceRecord | null>;
}

export interface GeneralSettingsClient {
  get(): Promise<GeneralSettings>;
  updateSkillEnabled(skillEnabled: boolean): Promise<GeneralSettings>;
  updateReinjectionDelay(minSeconds: number, maxSeconds: number): Promise<GeneralSettings>;
}

/** 创建由 Chrome 运行时消息支持的管理页面客户端。 */
export function createSkillLibraryClient(): SkillLibraryClient {
  return {
    async getCatalog() {
      return send<SkillMetadata[]>({ type: "catalog.get" });
    },
    async replace(skillPackage) {
      await send({ type: "skill.replace", skillPackage });
    },
    async delete(skillName) {
      await send({ type: "skill.delete", skillName });
    }
  };
}

/** 创建由 Chrome 权限和运行时消息支持的 MCP 管理客户端。 */
export function createMcpServiceClient(): McpServiceClient {
  return {
    async list() {
      return send<McpServiceRecord[]>({ type: "mcp.catalog.get" });
    },
    async add(endpoint) {
      const normalized = normalizeMcpEndpoint(endpoint);
      await requestMcpPermission(normalized.permissionOrigin);
      return send<McpServiceRecord>({ type: "mcp.service.add", endpoint });
    },
    async redetect(service) {
      await requestMcpPermission(service.permissionOrigin);
      return send<McpServiceRecord>({ type: "mcp.service.redetect", serviceId: service.serviceId });
    },
    async delete(serviceId) {
      return send<McpServiceRecord | null>({ type: "mcp.service.delete", serviceId });
    }
  };
}

/** 创建由 Chrome 运行时消息支持的通用设置客户端。 */
export function createGeneralSettingsClient(): GeneralSettingsClient {
  return {
    async get() {
      return send<GeneralSettings>({ type: "settings.get" });
    },
    async updateSkillEnabled(skillEnabled) {
      return send<GeneralSettings>({ type: "settings.skillEnabled.update", skillEnabled });
    },
    async updateReinjectionDelay(minSeconds, maxSeconds) {
      return send<GeneralSettings>({ type: "settings.reinjectionDelay.update", minSeconds, maxSeconds });
    }
  };
}

async function send<T = undefined>(request: RuntimeRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(request)) as RuntimeResponse<T>;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

async function requestMcpPermission(permissionOrigin: string): Promise<void> {
  const granted = await new Promise<boolean>((resolve, reject) => {
    chrome.permissions.request({ origins: [originToPermissionPattern(permissionOrigin)] }, (allowed) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(allowed);
    });
  });
  if (!granted) throw new Error("未授予该 MCP 服务的主机权限。");
}
