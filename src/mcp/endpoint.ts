import type { NormalizedMcpEndpoint } from "@/mcp/contracts";

const LOOPBACK_IPV4_PREFIX = /^127\./u;
const RFC1918_PREFIXES = [/^10\./u, /^192\.168\./u, /^172\.(1[6-9]|2\d|3[0-1])\./u];

/** 规范化用户输入的 MCP endpoint，并执行首版网络安全边界。 */
export function normalizeMcpEndpoint(input: string): NormalizedMcpEndpoint {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("MCP 地址不能为空。");

  const endpoint = parseMcpEndpoint(trimmed);
  if (endpoint.username || endpoint.password) throw new Error("MCP 地址不能包含用户名或密码。");
  if (endpoint.hash) throw new Error("MCP 地址不能包含 fragment。");
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("MCP 地址只支持 HTTP 或 HTTPS。");
  }
  if (!endpoint.hostname) throw new Error("MCP 地址缺少主机。");
  if (endpoint.port && !isValidPort(endpoint.port)) throw new Error("MCP 地址端口无效。");

  if (endpoint.protocol === "http:" && !isAllowedHttpHost(endpoint.hostname)) {
    throw new Error("公网 MCP 地址必须使用 HTTPS。");
  }
  endpoint.hash = "";
  return {
    endpoint: endpoint.toString(),
    permissionOrigin: endpoint.origin
  };
}

function parseMcpEndpoint(input: string): URL {
  if (/^https?:\/\//iu.test(input)) return new URL(input);
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/u.test(input)) return new URL(`http://${input}/mcp`);
  if (/^\[[0-9a-f:.]+\]:\d+$/iu.test(input)) return new URL(`http://${input}/mcp`);
  throw new Error("MCP 地址格式无效。");
}

function isValidPort(port: string): boolean {
  const value = Number(port);
  return Number.isInteger(value) && value > 0 && value <= 65_535;
}

function isAllowedHttpHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "::1") return true;
  if (isPrivateIpv4(normalized)) return true;
  return isUniqueLocalIpv6(normalized);
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  if (!parts.every((part) => /^\d+$/u.test(part) && Number(part) >= 0 && Number(part) <= 255)) return false;
  return LOOPBACK_IPV4_PREFIX.test(hostname) || RFC1918_PREFIXES.some((pattern) => pattern.test(hostname));
}

function isUniqueLocalIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd");
}
