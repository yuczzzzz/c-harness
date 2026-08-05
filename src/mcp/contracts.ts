export const MCP_LIMITS = {
  maxServices: 50,
  maxToolsPerService: 200,
  maxDetailBytes: 200 * 1024,
  connectTimeoutMs: 15_000,
  maxCallArgumentsBytes: 64 * 1024,
  maxToolResultBytes: 128 * 1024,
  callTimeoutMs: 60_000
} as const;

export type McpProtocolEra = "modern" | "legacy";
export type McpDetectionStatus = "available" | "unavailable";

export interface McpToolSummary {
  name: string;
  title?: string;
  description?: string;
  inputSchema: unknown;
}

export interface McpServiceDetails {
  serverName: string;
  serverTitle?: string;
  serverVersion?: string;
  instructions?: string;
  tools: McpToolSummary[];
  protocolEra: McpProtocolEra;
  detailSummary: string;
  detailBytes: number;
}

export interface McpServiceRecord {
  recordId: string;
  serviceId: string;
  endpoint: string;
  permissionOrigin: string;
  serverName: string;
  serverTitle?: string;
  serverVersion?: string;
  description: string;
  toolCount: number;
  detailSummary: string;
  protocolEra: McpProtocolEra;
  addedAt: string;
  lastVerifiedAt: string;
  lastDetectionAt: string;
  detectionStatus: McpDetectionStatus;
}

export interface McpServiceCatalogItem {
  serviceId: string;
  displayName: string;
  description: string;
  toolCount: number;
}

export interface McpSessionDisclosure {
  serviceId: string;
  displayName: string;
  detailSummary: string;
  disclosedAt: string;
}

export interface McpSessionDisclosureKey {
  siteOrigin: string;
  sessionId: string;
  recordId: string;
  detailSummary: string;
}

export interface McpToolCallRequest {
  serviceId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface McpToolCallResult {
  serviceId: string;
  toolName: string;
  content: string;
  contentType: "text" | "yaml";
  isError: boolean;
  detailSummary: string;
}

export interface McpSessionTrust {
  serviceId: string;
  displayName: string;
  detailSummary: string;
  trustedAt: string;
}

export interface NormalizedMcpEndpoint {
  endpoint: string;
  permissionOrigin: string;
}
