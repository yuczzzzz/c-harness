import type {
  McpServiceCatalogItem,
  McpServiceDetails,
  McpToolCallRequest,
  McpToolCallResult,
  McpServiceRecord,
  McpSessionDisclosure
} from "@/mcp/contracts";
import type { GeneralSettings } from "@/settings/store";
import type { ReferenceReadResult, SkillMetadata, SkillPackage, SkillReadResult } from "@/skills/contracts";

export type RuntimeOperatingSystem = "windows" | "macos" | "linux" | "other";

export type RuntimeRequest =
  | { type: "platform.get" }
  | { type: "catalog.get" }
  | { type: "settings.get" }
  | { type: "settings.skillEnabled.update"; skillEnabled: boolean }
  | { type: "settings.reinjectionDelay.update"; minSeconds: number; maxSeconds: number }
  | { type: "mcp.catalog.get" }
  | { type: "mcp.serviceCatalog.get" }
  | { type: "mcp.service.add"; endpoint: string }
  | { type: "mcp.service.redetect"; serviceId: string }
  | { type: "mcp.service.delete"; serviceId: string }
  | { type: "mcp.details.readBatch"; serviceIds: string[] }
  | { type: "mcp.session.disclosures.get"; sessionId: string }
  | { type: "mcp.session.disclosures.commit"; sessionId: string; serviceIds: string[] }
  | { type: "mcp.session.trust.get"; sessionId: string; serviceId: string }
  | { type: "mcp.session.trust.commit"; sessionId: string; serviceId: string }
  | ({ type: "mcp.tool.call"; sessionId: string } & McpToolCallRequest)
  | { type: "skill.readBatch"; skillNames: string[] }
  | { type: "reference.readBatch"; selectedSkillNames: string[]; virtualPaths: string[] }
  | { type: "reference.readProgressiveBatch"; selectedSkillNames: string[]; virtualPaths: string[] }
  | { type: "skill.resolve"; skillName: string }
  | { type: "reference.resolve"; virtualPath: string }
  | { type: "skill.replace"; skillPackage: SkillPackage }
  | { type: "skill.delete"; skillName: string };

export type RuntimeSuccess<T> = { ok: true; data: T };
export type RuntimeFailure = { ok: false; error: string };
export type RuntimeResponse<T = undefined> = RuntimeSuccess<T> | RuntimeFailure;

export type GeneralSettingsResponse = RuntimeResponse<GeneralSettings>;
export type PlatformResponse = RuntimeResponse<RuntimeOperatingSystem>;
export type CatalogResponse = RuntimeResponse<SkillMetadata[]>;
export type SkillBatchResponse = RuntimeResponse<SkillReadResult[]>;
export type ReferenceBatchResponse = RuntimeResponse<ReferenceReadResult[]>;
export type SkillResolveResponse = RuntimeResponse<SkillReadResult | null>;
export type ReferenceResolveResponse = RuntimeResponse<ReferenceReadResult | null>;
export type McpCatalogResponse = RuntimeResponse<McpServiceRecord[]>;
export type McpServiceMutationResponse = RuntimeResponse<McpServiceRecord | null>;
export type McpServiceCatalogResponse = RuntimeResponse<McpServiceCatalogItem[]>;
export type McpDetailsBatchResponse = RuntimeResponse<Array<{ serviceId: string; details: McpServiceDetails }>>;
export type McpSessionDisclosuresResponse = RuntimeResponse<McpSessionDisclosure[]>;
export type McpSessionTrustResponse = RuntimeResponse<boolean>;
export type McpToolCallResponse = RuntimeResponse<McpToolCallResult>;
