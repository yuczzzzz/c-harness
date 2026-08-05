import { type DBSchema, type IDBPDatabase, openDB } from "idb";

import {
  applySessionKnowledgeResources,
  emptySessionToolKnowledgeState,
  sha256Text,
  type SessionKnowledgeResource,
  type SessionKnowledgeResourceRecord,
  type SessionKnowledgeResourceResolver,
  type SessionToolKnowledgeState
} from "@/session-knowledge/state";

export interface SessionToolKnowledgeStore {
  loadSessionToolKnowledgeState(
    sessionId: string,
    resolver: SessionKnowledgeResourceResolver
  ): Promise<SessionToolKnowledgeState>;
  saveSessionKnowledgeResources(sessionId: string, resources: SessionKnowledgeResource[]): Promise<void>;
  bindTemporarySessionToolKnowledgeState(
    sessionId: string,
    temporaryState: SessionToolKnowledgeState
  ): Promise<void>;
}

interface SessionKnowledgeDatabase extends DBSchema {
  resources: {
    key: [string, string, string];
    value: SessionKnowledgeResourceRecord;
    indexes: { bySession: string };
  };
}

const DATABASE_VERSION = 1;
const RESOURCES_STORE = "resources";

/** 为一个站点源创建基于 IndexedDB 的会话工具知识存储。 */
export function createIndexedDbSessionToolKnowledgeStore(databaseName: string): SessionToolKnowledgeStore & {
  openDatabase(): Promise<IDBPDatabase<SessionKnowledgeDatabase>>;
  resetDatabaseConnection(): Promise<void>;
} {
  let databasePromise: Promise<IDBPDatabase<SessionKnowledgeDatabase>> | undefined;

  const openDatabase = (): Promise<IDBPDatabase<SessionKnowledgeDatabase>> => {
    databasePromise ??= openDB<SessionKnowledgeDatabase>(databaseName, DATABASE_VERSION, {
      upgrade(database) {
        const resources = database.createObjectStore(RESOURCES_STORE, {
          keyPath: ["sessionId", "resourceKind", "resourceId"]
        });
        resources.createIndex("bySession", "sessionId");
      }
    });
    return databasePromise;
  };

  const saveSessionKnowledgeResources = async (
    sessionId: string,
    resources: SessionKnowledgeResource[]
  ): Promise<void> => {
    if (resources.length === 0) return;
    const database = await openDatabase();
    const transaction = database.transaction(RESOURCES_STORE, "readwrite");
    const updatedAt = new Date().toISOString();
    for (const resource of resources) {
      await transaction.store.put({ sessionId, ...resource, updatedAt });
    }
    await transaction.done;
  };

  return {
    openDatabase,
    async loadSessionToolKnowledgeState(sessionId, resolver) {
      const database = await openDatabase();
      const records = await database.getAllFromIndex(RESOURCES_STORE, "bySession", sessionId);
      const state = emptySessionToolKnowledgeState();

      for (const record of records) {
        if (!isValidRecord(record, sessionId)) {
          await deleteRecordIfUnchanged(database, record);
          continue;
        }
        const current = record.resourceKind === "skill"
          ? await resolver.resolveSkill(record.resourceId)
          : await resolver.resolveReference(record.resourceId);
        if (!current || await sha256Text(current.content) !== record.contentDigest) {
          await deleteRecordIfUnchanged(database, record);
          continue;
        }
        applySessionKnowledgeResources(state, [record]);
      }
      return state;
    },
    saveSessionKnowledgeResources,
    async bindTemporarySessionToolKnowledgeState(sessionId, temporaryState) {
      const resources: SessionKnowledgeResource[] = [
        ...Array.from(temporaryState.skills, ([resourceId, contentDigest]) => ({
          resourceKind: "skill" as const,
          resourceId,
          contentDigest
        })),
        ...Array.from(temporaryState.references, ([resourceId, contentDigest]) => ({
          resourceKind: "reference" as const,
          resourceId,
          contentDigest
        }))
      ];
      await saveSessionKnowledgeResources(sessionId, resources);
    },
    async resetDatabaseConnection() {
      try {
        const database = await databasePromise;
        database?.close();
      } finally {
        databasePromise = undefined;
      }
    }
  };
}

async function deleteRecordIfUnchanged(
  database: IDBPDatabase<SessionKnowledgeDatabase>,
  staleRecord: SessionKnowledgeResourceRecord
): Promise<void> {
  const key: [string, string, string] = [staleRecord.sessionId, staleRecord.resourceKind, staleRecord.resourceId];
  const transaction = database.transaction(RESOURCES_STORE, "readwrite");
  const current = await transaction.store.get(key);
  if (current?.contentDigest === staleRecord.contentDigest && current.updatedAt === staleRecord.updatedAt) {
    await transaction.store.delete(key);
  }
  await transaction.done;
}

function isValidRecord(value: SessionKnowledgeResourceRecord, sessionId: string): boolean {
  return value.sessionId === sessionId &&
    (value.resourceKind === "skill" || value.resourceKind === "reference") &&
    typeof value.resourceId === "string" && value.resourceId.length > 0 &&
    typeof value.contentDigest === "string" && /^[0-9a-f]{64}$/u.test(value.contentDigest) &&
    typeof value.updatedAt === "string" && value.updatedAt.length > 0;
}
