import { createIndexedDbSessionToolKnowledgeStore } from "@/session-knowledge/store";

const DATABASE_NAME = "c-harness-zai-session-knowledge";

export const zaiSessionToolKnowledgeStore = createIndexedDbSessionToolKnowledgeStore(DATABASE_NAME);

/** 打开 z.ai 页面源会话知识数据库。 */
export const openZaiSessionToolKnowledgeDatabase = zaiSessionToolKnowledgeStore.openDatabase;

/** 关闭并清除 z.ai 会话知识数据库连接，以便进行确定性测试。 */
export const resetZaiSessionToolKnowledgeDatabaseConnection = zaiSessionToolKnowledgeStore.resetDatabaseConnection;
