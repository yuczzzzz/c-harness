import type { McpServiceDetails } from "@/mcp/contracts";
import {
  addMcpService,
  commitMcpSessionDisclosure,
  commitMcpSessionTrust,
  deleteMcpService,
  hasCurrentMcpSessionTrust,
  hasOtherMcpServiceWithOrigin,
  listMcpSessionDisclosures,
  listMcpSessionTrusts,
  listMcpServices,
  markMcpServiceUnavailable,
  openMcpDatabase,
  resetMcpDatabaseConnection,
  updateMcpServiceDetection
} from "@/mcp/store";

const DATABASE_NAME = "c-harness-mcp";

describe("MCP service store", () => {
  beforeEach(async () => {
    await resetMcpDatabaseConnection();
    await deleteDatabase(DATABASE_NAME);
  });

  afterEach(async () => {
    await resetMcpDatabaseConnection();
  });

  it("adds services with unique stable service ids", async () => {
    const first = await addMcpService("http://127.0.0.1:3000/mcp", "http://127.0.0.1:3000", details("weather"));
    const second = await addMcpService("http://127.0.0.1:3001/mcp", "http://127.0.0.1:3001", details("weather"));

    expect(first.serviceId).toBe("weather");
    expect(first.detectionStatus).toBe("available");
    expect(second.serviceId).toBe("weather-2");
    expect(await listMcpServices()).toHaveLength(2);
  });

  it("records failed detection without replacing the last verified details", async () => {
    const service = await addMcpService("http://127.0.0.1:3000/mcp", "http://127.0.0.1:3000", details("weather"));

    const unavailable = await markMcpServiceUnavailable("weather");

    expect(unavailable.detectionStatus).toBe("unavailable");
    expect(unavailable.lastDetectionAt).not.toBe("");
    expect(unavailable.lastVerifiedAt).toBe(service.lastVerifiedAt);
    expect(unavailable.detailSummary).toBe(service.detailSummary);
  });

  it("treats records saved before detection status existed as available", async () => {
    const service = await addMcpService("http://127.0.0.1:3000/mcp", "http://127.0.0.1:3000", details("weather"));
    const legacyService = { ...service } as Partial<typeof service>;
    delete legacyService.detectionStatus;
    delete legacyService.lastDetectionAt;
    const database = await openMcpDatabase();
    await database.put("services", legacyService as typeof service);

    const [normalized] = await listMcpServices();

    expect(normalized?.detectionStatus).toBe("available");
    expect(normalized?.lastDetectionAt).toBe(service.lastVerifiedAt);
  });

  it("rejects duplicate endpoints atomically", async () => {
    await addMcpService("http://127.0.0.1:3000/mcp", "http://127.0.0.1:3000", details("weather"));

    await expect(addMcpService(
      "http://127.0.0.1:3000/mcp",
      "http://127.0.0.1:3000",
      details("other")
    )).rejects.toThrow("该 MCP 地址已存在。");
    expect(await listMcpServices()).toHaveLength(1);
  });

  it("updates detection without changing service identity", async () => {
    await addMcpService("http://127.0.0.1:3000/mcp", "http://127.0.0.1:3000", details("weather"));

    const updated = await updateMcpServiceDetection("weather", {
      ...details("renamed"),
      detailSummary: "summary-2",
      tools: [{ name: "forecast", description: "Forecast", inputSchema: {} }]
    });

    expect(updated.serviceId).toBe("weather");
    expect(updated.serverName).toBe("renamed");
    expect(updated.toolCount).toBe(1);
    expect(updated.detailSummary).toBe("summary-2");
  });

  it("detects shared origins before revoking permissions", async () => {
    await addMcpService("http://127.0.0.1:3000/a", "http://127.0.0.1:3000", details("alpha"));
    await addMcpService("http://127.0.0.1:3000/b", "http://127.0.0.1:3000", details("bravo"));

    expect(await hasOtherMcpServiceWithOrigin("http://127.0.0.1:3000", "alpha")).toBe(true);
    await deleteMcpService("bravo");
    expect(await hasOtherMcpServiceWithOrigin("http://127.0.0.1:3000", "alpha")).toBe(false);
  });

  it("commits and lists session disclosures scoped by site and session", async () => {
    const service = await addMcpService("http://127.0.0.1:3000/mcp", "http://127.0.0.1:3000", details("weather"));
    await commitMcpSessionDisclosure("https://chat.deepseek.com", "session-a", service);
    await commitMcpSessionDisclosure("https://chat.z.ai", "session-a", service);

    expect(await listMcpSessionDisclosures("https://chat.deepseek.com", "session-a")).toEqual([{
      serviceId: "weather",
      displayName: "weather",
      detailSummary: "summary-weather",
      disclosedAt: expect.any(String)
    }]);
    expect(await listMcpSessionDisclosures("https://chat.deepseek.com", "session-b")).toEqual([]);
  });

  it("clears disclosures when detail summaries change or services are deleted", async () => {
    const service = await addMcpService("http://127.0.0.1:3000/mcp", "http://127.0.0.1:3000", details("weather"));
    await commitMcpSessionDisclosure("https://chat.deepseek.com", "session-a", service);

    await updateMcpServiceDetection("weather", details("weather", "summary-weather-v2"));

    expect(await listMcpSessionDisclosures("https://chat.deepseek.com", "session-a")).toEqual([]);

    const updated = (await listMcpServices())[0]!;
    await commitMcpSessionDisclosure("https://chat.deepseek.com", "session-a", updated);
    await deleteMcpService("weather");

    expect(await listMcpSessionDisclosures("https://chat.deepseek.com", "session-a")).toEqual([]);
  });

  it("commits trust and clears it when detail summaries change or services are deleted", async () => {
    const service = await addMcpService("http://127.0.0.1:3000/mcp", "http://127.0.0.1:3000", details("weather"));
    await commitMcpSessionTrust("https://chat.deepseek.com", "session-a", service);

    expect(await hasCurrentMcpSessionTrust("https://chat.deepseek.com", "session-a", service)).toBe(true);
    expect(await listMcpSessionTrusts("https://chat.deepseek.com", "session-a")).toEqual([{
      serviceId: "weather",
      displayName: "weather",
      detailSummary: "summary-weather",
      trustedAt: expect.any(String)
    }]);

    await updateMcpServiceDetection("weather", details("weather", "summary-weather-v2"));

    expect(await listMcpSessionTrusts("https://chat.deepseek.com", "session-a")).toEqual([]);

    const updated = (await listMcpServices())[0]!;
    await commitMcpSessionTrust("https://chat.deepseek.com", "session-a", updated);
    await deleteMcpService("weather");

    expect(await listMcpSessionTrusts("https://chat.deepseek.com", "session-a")).toEqual([]);
  });
});

function details(serverName: string, detailSummary = `summary-${serverName}`): McpServiceDetails {
  return {
    serverName,
    instructions: "Weather tools",
    tools: [{ name: "current", description: "Current weather", inputSchema: {} }],
    protocolEra: "modern",
    detailSummary,
    detailBytes: 100
  };
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
