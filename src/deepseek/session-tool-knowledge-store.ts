import { createIndexedDbSessionToolKnowledgeStore } from "@/session-knowledge/store";

const DATABASE_NAME = "c-harness-deepseek-session-knowledge";

export const deepSeekSessionToolKnowledgeStore = createIndexedDbSessionToolKnowledgeStore(DATABASE_NAME);

/** 打开仅包含逐资源内容摘要的 DeepSeek 页面源数据库。 */
export const openSessionToolKnowledgeDatabase = deepSeekSessionToolKnowledgeStore.openDatabase;

/** 加载一个会话，根据当前资源校验每个摘要，并仅移除过期条目。 */
export const loadSessionToolKnowledgeState = deepSeekSessionToolKnowledgeStore.loadSessionToolKnowledgeState;

/** 将成功读取合并到一个会话中，不替换其他标签页的资源记录。 */
export const saveSessionKnowledgeResources = deepSeekSessionToolKnowledgeStore.saveSessionKnowledgeResources;

/** 将临时新对话知识合并到其首个稳定的 DeepSeek 会话 ID。 */
export const bindTemporarySessionToolKnowledgeState = deepSeekSessionToolKnowledgeStore.bindTemporarySessionToolKnowledgeState;

/** 关闭并清除会话知识数据库连接，以便进行确定性测试。 */
export const resetSessionToolKnowledgeDatabaseConnection = deepSeekSessionToolKnowledgeStore.resetDatabaseConnection;
