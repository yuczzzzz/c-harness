import type { McpServiceCatalogItem, McpServiceRecord } from "@/mcp/contracts";

export type LocalEnvironmentMcpCandidate = Pick<
  McpServiceCatalogItem,
  "serviceId" | "serverName" | "serverTitle"
>;

export interface LocalEnvironmentMcpSelection {
  selected: LocalEnvironmentMcpCandidate | null;
  matches: LocalEnvironmentMcpCandidate[];
}

const LOCAL_ENVIRONMENT_SERVER_NAMES = new Set(["codexpro"]);

/** 按本地环境白名单筛选 MCP 服务，并返回 Harness 实际采用的服务。 */
export function selectLocalEnvironmentMcp(
  services: Array<LocalEnvironmentMcpCandidate | McpServiceRecord>
): LocalEnvironmentMcpSelection {
  const matches = services
    .filter((service) => LOCAL_ENVIRONMENT_SERVER_NAMES.has(service.serverName.toLocaleLowerCase()))
    .map((service) => ({
      serviceId: service.serviceId,
      serverName: service.serverName,
      serverTitle: service.serverTitle
    }))
    .sort(compareLocalEnvironmentCandidates);
  return {
    selected: matches[0] ?? null,
    matches
  };
}

/** 返回本地环境 MCP 在 Harness 和管理页中使用的展示名称。 */
export function displayLocalEnvironmentMcpName(service: LocalEnvironmentMcpCandidate): string {
  return service.serverTitle || service.serverName || service.serviceId;
}

function compareLocalEnvironmentCandidates(
  left: LocalEnvironmentMcpCandidate,
  right: LocalEnvironmentMcpCandidate
): number {
  if (Boolean(left.serverTitle) !== Boolean(right.serverTitle)) return left.serverTitle ? -1 : 1;
  const titleComparison = (left.serverTitle ?? "").localeCompare(right.serverTitle ?? "");
  if (titleComparison !== 0) return titleComparison;
  return left.serviceId.localeCompare(right.serviceId);
}
