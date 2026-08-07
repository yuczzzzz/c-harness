import { type DBSchema, type IDBPDatabase, type IDBPObjectStore, openDB } from "idb";

import {
  MCP_LIMITS,
  type McpServiceDetails,
  type McpServiceCatalogItem,
  type McpServiceRecord,
  type McpSessionDisclosure,
  type McpSessionTrust
} from "@/mcp/contracts";

const DATABASE_NAME = "c-harness-mcp";
const DATABASE_VERSION = 3;

interface McpDatabase extends DBSchema {
  services: {
    key: string;
    value: McpServiceRecord;
    indexes: {
      byServiceId: string;
      byEndpoint: string;
      byPermissionOrigin: string;
    };
  };
  serviceDisclosures: {
    key: [string, string, string, string];
    value: {
      siteOrigin: string;
      sessionId: string;
      recordId: string;
      detailSummary: string;
      serviceId: string;
      displayName: string;
      disclosedAt: string;
    };
    indexes: {
      bySession: [string, string];
      byRecord: string;
    };
  };
  serviceTrusts: {
    key: [string, string, string, string];
    value: {
      siteOrigin: string;
      sessionId: string;
      recordId: string;
      detailSummary: string;
      serviceId: string;
      displayName: string;
      trustedAt: string;
    };
    indexes: {
      bySession: [string, string];
      byRecord: string;
    };
  };
}

let databasePromise: Promise<IDBPDatabase<McpDatabase>> | undefined;

/** 打开扩展的 MCP 数据库。 */
export function openMcpDatabase(): Promise<IDBPDatabase<McpDatabase>> {
  databasePromise ??= openDB<McpDatabase>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const services = database.createObjectStore("services", { keyPath: "recordId" });
        services.createIndex("byServiceId", "serviceId", { unique: true });
        services.createIndex("byEndpoint", "endpoint", { unique: true });
        services.createIndex("byPermissionOrigin", "permissionOrigin");
      }
      if (oldVersion < 2) {
        const disclosures = database.createObjectStore("serviceDisclosures", {
          keyPath: ["siteOrigin", "sessionId", "recordId", "detailSummary"]
        });
        disclosures.createIndex("bySession", ["siteOrigin", "sessionId"]);
        disclosures.createIndex("byRecord", "recordId");
      }
      if (oldVersion < 3) {
        const trusts = database.createObjectStore("serviceTrusts", {
          keyPath: ["siteOrigin", "sessionId", "recordId", "detailSummary"]
        });
        trusts.createIndex("bySession", ["siteOrigin", "sessionId"]);
        trusts.createIndex("byRecord", "recordId");
      }
    }
  });
  return databasePromise;
}

/** 返回按服务 ID 排序的 MCP 服务记录。 */
export async function listMcpServices(): Promise<McpServiceRecord[]> {
  const database = await openMcpDatabase();
  return (await database.getAll("services"))
    .map(normalizeMcpServiceRecord)
    .sort((left, right) => left.serviceId.localeCompare(right.serviceId));
}

/** 返回给目标网站 Harness 使用的精简 MCP 服务目录。 */
export async function listMcpServiceCatalog(): Promise<McpServiceCatalogItem[]> {
  return (await listMcpServices()).map((service) => ({
    serviceId: service.serviceId,
    serverName: service.serverName,
    serverTitle: service.serverTitle,
    displayName: service.serverTitle || service.serverName || service.serviceId,
    description: service.description,
    toolCount: service.toolCount
  }));
}

/** 使用已发现详情添加一个新的 MCP 服务。 */
export async function addMcpService(
  endpoint: string,
  permissionOrigin: string,
  details: McpServiceDetails
): Promise<McpServiceRecord> {
  const database = await openMcpDatabase();
  const transaction = database.transaction("services", "readwrite");
  try {
    const store = transaction.objectStore("services");
    if (await store.index("byEndpoint").get(endpoint)) throw new Error("该 MCP 地址已存在。");
    if (await store.count() >= MCP_LIMITS.maxServices) {
      throw new Error(`最多保存 ${MCP_LIMITS.maxServices} 个 MCP 服务。`);
    }

    const existingIds = new Set((await store.getAll()).map((service) => service.serviceId));
    const now = new Date().toISOString();
    const record: McpServiceRecord = {
      recordId: crypto.randomUUID(),
      serviceId: makeUniqueServiceId(details.serverName, existingIds),
      endpoint,
      permissionOrigin,
      serverName: details.serverName,
      serverTitle: details.serverTitle,
      serverVersion: details.serverVersion,
      description: details.instructions?.trim() || details.serverTitle || details.serverName,
      toolCount: details.tools.length,
      detailSummary: details.detailSummary,
      protocolEra: details.protocolEra,
      addedAt: now,
      lastVerifiedAt: now,
      lastDetectionAt: now,
      detectionStatus: "available"
    };
    await store.add(record);
    await transaction.done;
    return record;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // IndexedDB 可能已经结束事务。
    }
    await transaction.done.catch(() => undefined);
    throw error;
  }
}

/** 使用最新发现结果重新检测并更新一个 MCP 服务。 */
export async function updateMcpServiceDetection(
  serviceId: string,
  details: McpServiceDetails
): Promise<McpServiceRecord> {
  const database = await openMcpDatabase();
  const transaction = database.transaction(["services", "serviceDisclosures", "serviceTrusts"], "readwrite");
  const store = transaction.objectStore("services");
  const existing = await store.index("byServiceId").get(serviceId);
  if (!existing) throw new Error("MCP 服务不存在。");
  const now = new Date().toISOString();

  const updated: McpServiceRecord = {
    ...existing,
    serverName: details.serverName,
    serverTitle: details.serverTitle,
    serverVersion: details.serverVersion,
    description: details.instructions?.trim() || details.serverTitle || details.serverName,
    toolCount: details.tools.length,
    detailSummary: details.detailSummary,
    protocolEra: details.protocolEra,
    lastVerifiedAt: now,
    lastDetectionAt: now,
    detectionStatus: "available"
  };
  await store.put(updated);
  if (existing.detailSummary !== updated.detailSummary) {
    await deleteDisclosuresForRecord(transaction.objectStore("serviceDisclosures"), existing.recordId);
    await deleteTrustsForRecord(transaction.objectStore("serviceTrusts"), existing.recordId);
  }
  await transaction.done;
  return updated;
}

/** 记录 MCP 服务最近一次重新检测失败，同时保留上次成功发现的服务详情。 */
export async function markMcpServiceUnavailable(serviceId: string): Promise<McpServiceRecord> {
  const database = await openMcpDatabase();
  const transaction = database.transaction("services", "readwrite");
  const store = transaction.objectStore("services");
  const existing = await store.index("byServiceId").get(serviceId);
  if (!existing) throw new Error("MCP 服务不存在。");

  const updated: McpServiceRecord = {
    ...normalizeMcpServiceRecord(existing),
    lastDetectionAt: new Date().toISOString(),
    detectionStatus: "unavailable"
  };
  await store.put(updated);
  await transaction.done;
  return updated;
}

/** 按服务 ID 删除 MCP 服务；不存在时保持幂等。 */
export async function deleteMcpService(serviceId: string): Promise<McpServiceRecord | null> {
  const database = await openMcpDatabase();
  const transaction = database.transaction(["services", "serviceDisclosures", "serviceTrusts"], "readwrite");
  const store = transaction.objectStore("services");
  const existing = await store.index("byServiceId").get(serviceId);
  if (!existing) {
    await transaction.done;
    return null;
  }
  await store.delete(existing.recordId);
  await deleteDisclosuresForRecord(transaction.objectStore("serviceDisclosures"), existing.recordId);
  await deleteTrustsForRecord(transaction.objectStore("serviceTrusts"), existing.recordId);
  await transaction.done;
  return existing;
}

/** 按服务 ID 返回单个 MCP 服务记录。 */
export async function getMcpServiceById(serviceId: string): Promise<McpServiceRecord | null> {
  const database = await openMcpDatabase();
  const service = await database.getFromIndex("services", "byServiceId", serviceId);
  return service ? normalizeMcpServiceRecord(service) : null;
}

/** 判断某个权限 origin 是否仍被其他服务使用。 */
export async function hasOtherMcpServiceWithOrigin(permissionOrigin: string, excludedServiceId: string): Promise<boolean> {
  const database = await openMcpDatabase();
  const services = await database.getAllFromIndex("services", "byPermissionOrigin", permissionOrigin);
  return services.some((service) => service.serviceId !== excludedServiceId);
}

function normalizeMcpServiceRecord(service: McpServiceRecord): McpServiceRecord {
  return {
    ...service,
    lastDetectionAt: service.lastDetectionAt ?? service.lastVerifiedAt,
    detectionStatus: service.detectionStatus ?? "available"
  };
}

/** 返回当前站点会话已经披露的 MCP 服务摘要。 */
export async function listMcpSessionDisclosures(siteOrigin: string, sessionId: string): Promise<McpSessionDisclosure[]> {
  const database = await openMcpDatabase();
  const records = await database.getAllFromIndex("serviceDisclosures", "bySession", [siteOrigin, sessionId]);
  return records
    .map((record) => ({
      serviceId: record.serviceId,
      displayName: record.displayName,
      detailSummary: record.detailSummary,
      disclosedAt: record.disclosedAt
    }))
    .sort((left, right) => left.serviceId.localeCompare(right.serviceId));
}

/** 记录当前站点会话已成功披露某个 MCP 服务详情。 */
export async function commitMcpSessionDisclosure(
  siteOrigin: string,
  sessionId: string,
  service: McpServiceRecord
): Promise<void> {
  const database = await openMcpDatabase();
  await database.put("serviceDisclosures", {
    siteOrigin,
    sessionId,
    recordId: service.recordId,
    detailSummary: service.detailSummary,
    serviceId: service.serviceId,
    displayName: service.serverTitle || service.serverName || service.serviceId,
    disclosedAt: new Date().toISOString()
  });
}

/** 判断当前站点会话是否已经披露最新 MCP 服务详情。 */
export async function hasCurrentMcpSessionDisclosure(
  siteOrigin: string,
  sessionId: string,
  service: McpServiceRecord
): Promise<boolean> {
  const database = await openMcpDatabase();
  const record = await database.get("serviceDisclosures", [
    siteOrigin,
    sessionId,
    service.recordId,
    service.detailSummary
  ]);
  return Boolean(record);
}

/** 返回当前站点会话已信任的 MCP 服务摘要。 */
export async function listMcpSessionTrusts(siteOrigin: string, sessionId: string): Promise<McpSessionTrust[]> {
  const database = await openMcpDatabase();
  const records = await database.getAllFromIndex("serviceTrusts", "bySession", [siteOrigin, sessionId]);
  return records
    .map((record) => ({
      serviceId: record.serviceId,
      displayName: record.displayName,
      detailSummary: record.detailSummary,
      trustedAt: record.trustedAt
    }))
    .sort((left, right) => left.serviceId.localeCompare(right.serviceId));
}

/** 判断当前站点会话是否信任最新 MCP 服务详情。 */
export async function hasCurrentMcpSessionTrust(
  siteOrigin: string,
  sessionId: string,
  service: McpServiceRecord
): Promise<boolean> {
  const database = await openMcpDatabase();
  const record = await database.get("serviceTrusts", [
    siteOrigin,
    sessionId,
    service.recordId,
    service.detailSummary
  ]);
  return Boolean(record);
}

/** 记录当前站点会话信任某个 MCP 服务的最新详情摘要。 */
export async function commitMcpSessionTrust(
  siteOrigin: string,
  sessionId: string,
  service: McpServiceRecord
): Promise<void> {
  const database = await openMcpDatabase();
  await database.put("serviceTrusts", {
    siteOrigin,
    sessionId,
    recordId: service.recordId,
    detailSummary: service.detailSummary,
    serviceId: service.serviceId,
    displayName: service.serverTitle || service.serverName || service.serviceId,
    trustedAt: new Date().toISOString()
  });
}

/** 重置测试环境中的 MCP 数据库连接。 */
export async function resetMcpDatabaseConnection(): Promise<void> {
  const database = await databasePromise;
  database?.close();
  databasePromise = undefined;
}

async function deleteDisclosuresForRecord(
  store: IDBPObjectStore<McpDatabase, ["services", "serviceDisclosures", "serviceTrusts"], "serviceDisclosures", "readwrite">,
  recordId: string
): Promise<void> {
  const index = store.index("byRecord");
  let cursor = await index.openCursor(IDBKeyRange.only(recordId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
}

async function deleteTrustsForRecord(
  store: IDBPObjectStore<McpDatabase, ["services", "serviceDisclosures", "serviceTrusts"], "serviceTrusts", "readwrite">,
  recordId: string
): Promise<void> {
  const index = store.index("byRecord");
  let cursor = await index.openCursor(IDBKeyRange.only(recordId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
}

function makeUniqueServiceId(serverName: string, existingIds: Set<string>): string {
  const base = normalizeServiceId(serverName) || `mcp-${crypto.randomUUID().slice(0, 8)}`;
  if (!existingIds.has(base)) return base;
  for (let index = 2; index <= MCP_LIMITS.maxServices + 1; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  throw new Error("无法生成唯一 MCP 服务 ID。");
}

function normalizeServiceId(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
}
