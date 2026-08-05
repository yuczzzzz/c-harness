/** 非阻塞请求删除旧项目绑定数据库；任何结果都不影响页面增强流程。 */
export function requestLegacyProjectBindingDatabaseDeletion(
  databaseName: string,
  databaseFactory: IDBFactory = indexedDB
): void {
  try {
    const request = databaseFactory.deleteDatabase(databaseName);
    request.onerror = () => undefined;
    request.onblocked = () => undefined;
    request.onsuccess = () => undefined;
  } catch {
    // 旧项目绑定清理不能阻断正常问答；后续页面启动会再次尝试删除。
  }
}
