/** 将 URL origin 转为 Chrome host permission pattern。 */
export function originToPermissionPattern(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

/** 检查扩展是否已经拥有某个 MCP origin 的主机权限。 */
export async function hasMcpHostPermission(permissionOrigin: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [originToPermissionPattern(permissionOrigin)] });
}

/** 撤销不再使用的 MCP origin 主机权限。 */
export async function removeMcpHostPermission(permissionOrigin: string): Promise<void> {
  await chrome.permissions.remove({ origins: [originToPermissionPattern(permissionOrigin)] });
}
