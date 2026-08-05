import { normalizeMcpEndpoint } from "@/mcp/endpoint";

describe("normalizeMcpEndpoint", () => {
  it.each([
    ["https://example.com/mcp", "https://example.com/mcp"],
    ["http://localhost:3000/custom", "http://localhost:3000/custom"],
    ["127.0.0.1:3000", "http://127.0.0.1:3000/mcp"],
    ["192.168.1.20:8080", "http://192.168.1.20:8080/mcp"],
    ["[fd00::1]:9000", "http://[fd00::1]:9000/mcp"]
  ])("accepts %s", (input, endpoint) => {
    expect(normalizeMcpEndpoint(input).endpoint).toBe(endpoint);
  });

  it.each([
    "http://example.com/mcp",
    "ftp://example.com/mcp",
    "https://user@example.com/mcp",
    "https://example.com/mcp#fragment",
    "example.com:3000",
    "127.0.0.1:99999"
  ])("rejects %s", (input) => {
    expect(() => normalizeMcpEndpoint(input)).toThrow();
  });
});
