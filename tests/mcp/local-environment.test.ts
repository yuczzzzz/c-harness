import type { McpServiceRecord } from "@/mcp/contracts";
import { displayLocalEnvironmentMcpName, selectLocalEnvironmentMcp } from "@/mcp/local-environment";

describe("local environment MCP selection", () => {
  it("matches only whitelisted server names case-insensitively", () => {
    const selection = selectLocalEnvironmentMcp([
      record("weather", "weather"),
      record("codex-a", "CodexPro")
    ]);

    expect(selection.matches.map((service) => service.serviceId)).toEqual(["codex-a"]);
    expect(selection.selected?.serviceId).toBe("codex-a");
  });

  it("sorts titled services first, then by title and service id", () => {
    const selection = selectLocalEnvironmentMcp([
      record("untitled", "codexpro"),
      record("bravo-2", "codexpro", "Bravo"),
      record("alpha", "codexpro", "Alpha"),
      record("bravo-1", "codexpro", "Bravo")
    ]);

    expect(selection.matches.map((service) => service.serviceId)).toEqual(["alpha", "bravo-1", "bravo-2", "untitled"]);
    expect(displayLocalEnvironmentMcpName(selection.selected!)).toBe("Alpha");
  });

  it("falls back display name from title to server name to service id", () => {
    expect(displayLocalEnvironmentMcpName({ serviceId: "a", serverName: "codexpro", serverTitle: "CodexPro" })).toBe("CodexPro");
    expect(displayLocalEnvironmentMcpName({ serviceId: "a", serverName: "codexpro" })).toBe("codexpro");
    expect(displayLocalEnvironmentMcpName({ serviceId: "a", serverName: "" })).toBe("a");
  });
});

function record(serviceId: string, serverName: string, serverTitle?: string): McpServiceRecord {
  return {
    recordId: serviceId,
    serviceId,
    endpoint: "http://127.0.0.1:3000/mcp",
    permissionOrigin: "http://127.0.0.1:3000",
    serverName,
    serverTitle,
    description: "Local service",
    toolCount: 1,
    detailSummary: "summary",
    protocolEra: "modern",
    addedAt: "2026-08-07T00:00:00.000Z",
    lastVerifiedAt: "2026-08-07T00:00:00.000Z",
    lastDetectionAt: "2026-08-07T00:00:00.000Z",
    detectionStatus: "available"
  };
}
