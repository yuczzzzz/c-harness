export interface ParsedReferencePath {
  skillName: string;
  storedPath: string;
}

/** 返回值是否为不含路径语法且可安全持久化的 Skill 标识。 */
export function isSafeSkillName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Boolean(value) &&
    value !== "." &&
    value !== ".." &&
    !/[\\/\u0000-\u001f\u007f]/u.test(value)
  );
}

/** 解析规范的 `{skill}/references/...` 虚拟路径，不规范化不安全输入。 */
export function parseReferenceVirtualPath(value: unknown): ParsedReferencePath | null {
  if (typeof value !== "string" || !value || /[\\\u0000-\u001f\u007f]/u.test(value)) return null;
  const segments = value.split("/");
  if (
    segments.length < 3 ||
    !isSafeSkillName(segments[0]) ||
    segments[1] !== "references" ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return { skillName: segments[0], storedPath: segments.slice(1).join("/") };
}
