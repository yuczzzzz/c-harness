import { vi } from "vitest";

import { handleRuntimeRequest } from "@/background/runtime";
import { callMcpEndpointTool, discoverMcpEndpoint } from "@/mcp/client";
import type { McpServiceDetails } from "@/mcp/contracts";
import { resetMcpDatabaseConnection } from "@/mcp/store";
import { resetSettingsDatabaseConnection, updateSkillEnabled } from "@/settings/store";
import type { SkillPackage } from "@/skills/contracts";
import { openSkillDatabase, replaceSkill, resetSkillDatabaseConnection } from "@/skills/store";

const DATABASE_NAME = "c-harness";
const MCP_DATABASE_NAME = "c-harness-mcp";
const SETTINGS_DATABASE_NAME = "c-harness-settings";
const EXTENSION_ID = "test-extension";

vi.mock("@/mcp/client", () => ({
  discoverMcpEndpoint: vi.fn(),
  callMcpEndpointTool: vi.fn()
}));

describe("background runtime", () => {
  beforeEach(async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        id: EXTENSION_ID,
        getURL: (path: string) => `chrome-extension://${EXTENSION_ID}/${path}`
      },
      permissions: {
        contains: vi.fn(async () => true),
        remove: vi.fn(async () => true)
      }
    });
    vi.mocked(discoverMcpEndpoint).mockResolvedValue(mcpDetails("weather"));
    vi.mocked(callMcpEndpointTool).mockResolvedValue({
      serviceId: "weather",
      toolName: "current",
      content: "clear",
      contentType: "text",
      isError: false,
      detailSummary: "summary-weather"
    });
    await resetSkillDatabaseConnection();
    await resetMcpDatabaseConnection();
    await resetSettingsDatabaseConnection();
    await deleteDatabase(DATABASE_NAME);
    await deleteDatabase(MCP_DATABASE_NAME);
    await deleteDatabase(SETTINGS_DATABASE_NAME);
  });

  afterEach(async () => {
    await resetSkillDatabaseConnection();
    await resetMcpDatabaseConnection();
    await resetSettingsDatabaseConnection();
    vi.unstubAllGlobals();
  });

  it("allows the options page to read the catalog", async () => {
    await replaceSkill(packageFor("writer"));

    const response = await handleRuntimeRequest(
      { type: "catalog.get" },
      { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/options.html` }
    );

    expect(response).toEqual({ ok: true, data: [expect.objectContaining({ name: "writer" })] });
  });

  it("allows options and trusted chat senders to read settings but only options can update them", async () => {
    const optionsRead = await handleRuntimeRequest({ type: "settings.get" }, optionsSender("#/skills"));
    const chatRead = await handleRuntimeRequest({ type: "settings.get" }, deepSeekSender());
    const chatUpdate = await handleRuntimeRequest(
      { type: "settings.skillEnabled.update", skillEnabled: false },
      deepSeekSender()
    );
    const optionsUpdate = await handleRuntimeRequest(
      { type: "settings.skillEnabled.update", skillEnabled: false },
      optionsSender("#/skills")
    );
    const chatDelayUpdate = await handleRuntimeRequest(
      { type: "settings.reinjectionDelay.update", minSeconds: 2, maxSeconds: 4 },
      deepSeekSender()
    );
    const optionsDelayUpdate = await handleRuntimeRequest(
      { type: "settings.reinjectionDelay.update", minSeconds: 2, maxSeconds: 4 },
      optionsSender("#/general")
    );

    expect(optionsRead).toEqual({ ok: true, data: expect.objectContaining({ skillEnabled: true }) });
    expect(chatRead).toEqual({ ok: true, data: expect.objectContaining({ skillEnabled: true }) });
    expect(chatUpdate).toEqual({ ok: false, error: "只有扩展管理页可以修改通用设置。" });
    expect(optionsUpdate).toEqual({ ok: true, data: expect.objectContaining({ skillEnabled: false }) });
    expect(chatDelayUpdate).toEqual({ ok: false, error: "只有扩展管理页可以修改通用设置。" });
    expect(optionsDelayUpdate).toEqual({
      ok: true,
      data: {
        skillEnabled: false,
        reinjectionDelayMinSeconds: 2,
        reinjectionDelayMaxSeconds: 4
      }
    });
  });

  it("adds and lists an MCP service from the options page", async () => {
    const addResponse = await handleRuntimeRequest(
      { type: "mcp.service.add", endpoint: "127.0.0.1:3000" },
      optionsSender("#/mcp")
    );
    const catalogResponse = await handleRuntimeRequest({ type: "mcp.catalog.get" }, optionsSender("#/mcp"));

    expect(discoverMcpEndpoint).toHaveBeenCalledWith("http://127.0.0.1:3000/mcp");
    expect(addResponse).toEqual({ ok: true, data: expect.objectContaining({ serviceId: "weather" }) });
    expect(catalogResponse).toEqual({ ok: true, data: [expect.objectContaining({ serviceId: "weather" })] });
  });

  it("rejects MCP mutations from chat tabs and missing permissions", async () => {
    const chatResponse = await handleRuntimeRequest(
      { type: "mcp.service.add", endpoint: "127.0.0.1:3000" },
      deepSeekSender()
    );
    vi.mocked(chrome.permissions.contains as () => Promise<boolean>).mockResolvedValue(false);
    const permissionResponse = await handleRuntimeRequest(
      { type: "mcp.service.add", endpoint: "127.0.0.1:3000" },
      optionsSender()
    );

    expect(chatResponse).toEqual({ ok: false, error: "只有扩展管理页可以添加 MCP 服务。" });
    expect(permissionResponse).toEqual({ ok: false, error: "尚未授予该 MCP 服务的主机权限。" });
  });

  it("redetects and deletes MCP services while revoking unused permissions", async () => {
    await handleRuntimeRequest({ type: "mcp.service.add", endpoint: "127.0.0.1:3000" }, optionsSender());
    vi.mocked(discoverMcpEndpoint).mockResolvedValue(mcpDetails("weather", "summary-2"));

    const redetectResponse = await handleRuntimeRequest(
      { type: "mcp.service.redetect", serviceId: "weather" },
      optionsSender()
    );
    const deleteResponse = await handleRuntimeRequest(
      { type: "mcp.service.delete", serviceId: "weather" },
      optionsSender()
    );

    expect(redetectResponse).toEqual({ ok: true, data: expect.objectContaining({ detailSummary: "summary-2" }) });
    expect(deleteResponse).toEqual({ ok: true, data: expect.objectContaining({ serviceId: "weather" }) });
    expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: ["http://127.0.0.1/*"] });
  });

  it("marks an MCP service unavailable when redetection fails", async () => {
    await handleRuntimeRequest({ type: "mcp.service.add", endpoint: "127.0.0.1:3000" }, optionsSender());
    vi.mocked(discoverMcpEndpoint).mockRejectedValueOnce(new Error("Failed to fetch"));

    const redetectResponse = await handleRuntimeRequest(
      { type: "mcp.service.redetect", serviceId: "weather" },
      optionsSender()
    );
    const catalogResponse = await handleRuntimeRequest({ type: "mcp.catalog.get" }, optionsSender());

    expect(redetectResponse).toEqual({ ok: false, error: "Failed to fetch" });
    expect(catalogResponse).toEqual({
      ok: true,
      data: [expect.objectContaining({ serviceId: "weather", detectionStatus: "unavailable" })]
    });
  });

  it("lets trusted chat tabs read MCP details and commit session disclosures by sender origin", async () => {
    await handleRuntimeRequest({ type: "mcp.service.add", endpoint: "127.0.0.1:3000" }, optionsSender());
    vi.mocked(discoverMcpEndpoint).mockClear();
    vi.mocked(discoverMcpEndpoint).mockResolvedValue(mcpDetails("weather"));

    const detailsResponse = await handleRuntimeRequest(
      { type: "mcp.details.readBatch", serviceIds: ["weather"] },
      deepSeekSender()
    );
    const commitResponse = await handleRuntimeRequest(
      { type: "mcp.session.disclosures.commit", sessionId: "session-a", serviceIds: ["weather"] },
      deepSeekSender()
    );
    const deepSeekDisclosures = await handleRuntimeRequest(
      { type: "mcp.session.disclosures.get", sessionId: "session-a" },
      deepSeekSender()
    );
    const zaiDisclosures = await handleRuntimeRequest(
      { type: "mcp.session.disclosures.get", sessionId: "session-a" },
      zaiSender()
    );

    expect(discoverMcpEndpoint).toHaveBeenCalledWith("http://127.0.0.1:3000/mcp");
    expect(detailsResponse).toEqual({
      ok: true,
      data: [{ serviceId: "weather", details: expect.objectContaining({ detailSummary: "summary-weather" }) }]
    });
    expect(commitResponse).toEqual({ ok: true, data: undefined });
    expect(deepSeekDisclosures).toEqual({
      ok: true,
      data: [expect.objectContaining({ serviceId: "weather", detailSummary: "summary-weather" })]
    });
    expect(zaiDisclosures).toEqual({ ok: true, data: [] });
  });

  it("invalidates old MCP disclosures when a details read observes a changed summary", async () => {
    await handleRuntimeRequest({ type: "mcp.service.add", endpoint: "127.0.0.1:3000" }, optionsSender());
    await handleRuntimeRequest(
      { type: "mcp.session.disclosures.commit", sessionId: "session-a", serviceIds: ["weather"] },
      deepSeekSender()
    );
    vi.mocked(discoverMcpEndpoint).mockResolvedValue(mcpDetails("weather", "summary-v2"));

    const detailsResponse = await handleRuntimeRequest(
      { type: "mcp.details.readBatch", serviceIds: ["weather"] },
      deepSeekSender()
    );
    const disclosures = await handleRuntimeRequest(
      { type: "mcp.session.disclosures.get", sessionId: "session-a" },
      deepSeekSender()
    );

    expect(detailsResponse).toEqual({
      ok: true,
      data: [{ serviceId: "weather", details: expect.objectContaining({ detailSummary: "summary-v2" }) }]
    });
    expect(disclosures).toEqual({ ok: true, data: [] });
  });

  it.each([
    ["options sender", optionsSender(), { type: "mcp.details.readBatch", serviceIds: ["weather"] }],
    ["duplicate service ids", deepSeekSender(), { type: "mcp.details.readBatch", serviceIds: ["weather", "weather"] }],
    ["unsafe session id", deepSeekSender(), { type: "mcp.session.disclosures.get", sessionId: "bad\0id" }]
  ])("rejects MCP disclosure requests from or containing %s", async (_label, sender, request) => {
    const response = await handleRuntimeRequest(request, sender);

    expect(response.ok).toBe(false);
  });

  it("calls an MCP Tool only after current-session details were disclosed", async () => {
    await handleRuntimeRequest({ type: "mcp.service.add", endpoint: "127.0.0.1:3000" }, optionsSender());
    await handleRuntimeRequest(
      { type: "mcp.session.disclosures.commit", sessionId: "session-a", serviceIds: ["weather"] },
      deepSeekSender()
    );

    const response = await handleRuntimeRequest({
      type: "mcp.tool.call",
      sessionId: "session-a",
      serviceId: "weather",
      toolName: "current",
      arguments: { city: "Shanghai" }
    }, deepSeekSender());

    expect(callMcpEndpointTool).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/mcp",
      "weather",
      "summary-weather",
      "current",
      { city: "Shanghai" }
    );
    expect(response).toEqual({
      ok: true,
      data: {
        serviceId: "weather",
        toolName: "current",
        content: "clear",
        contentType: "text",
        isError: false,
        detailSummary: "summary-weather"
      }
    });
  });

  it("rejects MCP Tool calls without disclosure or after summary changes", async () => {
    await handleRuntimeRequest({ type: "mcp.service.add", endpoint: "127.0.0.1:3000" }, optionsSender());

    const undisclosed = await handleRuntimeRequest({
      type: "mcp.tool.call",
      sessionId: "session-a",
      serviceId: "weather",
      toolName: "current",
      arguments: {}
    }, deepSeekSender());
    await handleRuntimeRequest(
      { type: "mcp.session.disclosures.commit", sessionId: "session-a", serviceIds: ["weather"] },
      deepSeekSender()
    );
    vi.mocked(discoverMcpEndpoint).mockResolvedValue(mcpDetails("weather", "summary-v2"));
    const stale = await handleRuntimeRequest({
      type: "mcp.tool.call",
      sessionId: "session-a",
      serviceId: "weather",
      toolName: "current",
      arguments: {}
    }, deepSeekSender());

    expect(undisclosed).toEqual({ ok: false, error: "当前会话尚未披露该 MCP 服务详情。" });
    expect(stale).toEqual({ ok: false, error: "MCP 服务详情已变化，请先重新读取该服务详情。" });
  });

  it("commits and reads current-session MCP trust", async () => {
    await handleRuntimeRequest({ type: "mcp.service.add", endpoint: "127.0.0.1:3000" }, optionsSender());
    await handleRuntimeRequest(
      { type: "mcp.session.disclosures.commit", sessionId: "session-a", serviceIds: ["weather"] },
      deepSeekSender()
    );

    const before = await handleRuntimeRequest(
      { type: "mcp.session.trust.get", sessionId: "session-a", serviceId: "weather" },
      deepSeekSender()
    );
    const commit = await handleRuntimeRequest(
      { type: "mcp.session.trust.commit", sessionId: "session-a", serviceId: "weather" },
      deepSeekSender()
    );
    const after = await handleRuntimeRequest(
      { type: "mcp.session.trust.get", sessionId: "session-a", serviceId: "weather" },
      deepSeekSender()
    );

    expect(before).toEqual({ ok: true, data: false });
    expect(commit).toEqual({ ok: true, data: undefined });
    expect(after).toEqual({ ok: true, data: true });
  });

  it("rejects mutations from an allowed DeepSeek tab", async () => {
    const response = await handleRuntimeRequest(
      { type: "skill.replace", skillPackage: packageFor("writer") },
      { id: EXTENSION_ID, url: "https://chat.deepseek.com/", tab: { id: 7 } as chrome.tabs.Tab }
    );

    expect(response).toEqual({ ok: false, error: "只有扩展管理页可以保存 Skill。" });
  });

  it("rejects a package with inconsistent file ownership", async () => {
    const skillPackage = packageFor("writer");
    skillPackage.files[0]!.skillName = "other";

    const response = await handleRuntimeRequest(
      { type: "skill.replace", skillPackage },
      { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/options.html` }
    );

    expect(response).toEqual({ ok: false, error: "Skill 包数据无效。" });
  });

  it("reads a complete Skill batch from a trusted DeepSeek tab in request order", async () => {
    await replaceSkill(packageFor("writer"));
    await replaceSkill(packageFor("eval-design"));

    const response = await handleRuntimeRequest(
      { type: "skill.readBatch", skillNames: ["writer", "eval-design"] },
      deepSeekSender()
    );

    expect(response).toEqual({
      ok: true,
      data: [
        expect.objectContaining({ skillName: "writer" }),
        expect.objectContaining({ skillName: "eval-design" })
      ]
    });
  });

  it("allows the same read-only requests from a trusted z.ai tab", async () => {
    await replaceSkill(packageWithReferences("writer", { "references/a.md": "alpha" }));

    const catalog = await handleRuntimeRequest({ type: "catalog.get" }, zaiSender());
    const skills = await handleRuntimeRequest(
      { type: "skill.readBatch", skillNames: ["writer"] },
      zaiSender()
    );
    const references = await handleRuntimeRequest({
      type: "reference.readBatch",
      selectedSkillNames: ["writer"],
      virtualPaths: ["writer/references/a.md"]
    }, zaiSender());
    const progressiveReferences = await handleRuntimeRequest({
      type: "reference.readProgressiveBatch",
      selectedSkillNames: ["writer"],
      virtualPaths: ["writer/references/a.md"]
    }, zaiSender());
    const resolvedSkill = await handleRuntimeRequest(
      { type: "skill.resolve", skillName: "writer" },
      zaiSender()
    );
    const resolvedReference = await handleRuntimeRequest(
      { type: "reference.resolve", virtualPath: "writer/references/a.md" },
      zaiSender()
    );

    expect(catalog.ok).toBe(true);
    expect(skills.ok).toBe(true);
    expect(references.ok).toBe(true);
    expect(progressiveReferences.ok).toBe(true);
    expect(resolvedSkill).toEqual({
      ok: true,
      data: expect.objectContaining({ skillName: "writer" })
    });
    expect(resolvedReference).toEqual({
      ok: true,
      data: expect.objectContaining({ virtualPath: "writer/references/a.md" })
    });
  });

  it("blocks Skill catalog and body reads from chat tabs when Skill is disabled", async () => {
    await replaceSkill(packageWithReferences("writer", { "references/a.md": "alpha" }));
    await updateSkillEnabled(false);

    const catalog = await handleRuntimeRequest({ type: "catalog.get" }, deepSeekSender());
    const skill = await handleRuntimeRequest({ type: "skill.readBatch", skillNames: ["writer"] }, deepSeekSender());
    const reference = await handleRuntimeRequest({
      type: "reference.readBatch",
      selectedSkillNames: ["writer"],
      virtualPaths: ["writer/references/a.md"]
    }, deepSeekSender());
    const progressiveReference = await handleRuntimeRequest({
      type: "reference.readProgressiveBatch",
      selectedSkillNames: ["writer"],
      virtualPaths: ["writer/references/a.md"]
    }, deepSeekSender());
    const resolvedSkill = await handleRuntimeRequest({ type: "skill.resolve", skillName: "writer" }, deepSeekSender());
    const resolvedReference = await handleRuntimeRequest({
      type: "reference.resolve",
      virtualPath: "writer/references/a.md"
    }, deepSeekSender());
    const optionsCatalog = await handleRuntimeRequest({ type: "catalog.get" }, optionsSender("#/skills"));
    const replace = await handleRuntimeRequest({ type: "skill.replace", skillPackage: packageFor("review") }, optionsSender("#/skills"));
    const deletion = await handleRuntimeRequest({ type: "skill.delete", skillName: "review" }, optionsSender("#/skills"));

    expect(catalog).toEqual({ ok: false, error: "Skill 功能已停用。" });
    expect(skill).toEqual({ ok: false, error: "Skill 功能已停用。" });
    expect(reference).toEqual({ ok: false, error: "Skill 功能已停用。" });
    expect(progressiveReference).toEqual({ ok: false, error: "Skill 功能已停用。" });
    expect(resolvedSkill).toEqual({ ok: false, error: "Skill 功能已停用。" });
    expect(resolvedReference).toEqual({ ok: false, error: "Skill 功能已停用。" });
    expect(optionsCatalog).toEqual({ ok: true, data: [expect.objectContaining({ name: "writer" })] });
    expect(replace).toEqual({ ok: true, data: undefined });
    expect(deletion).toEqual({ ok: true, data: undefined });
  });

  it.each([
    { type: "reference.readProgressiveBatch", selectedSkillNames: ["writer"], virtualPaths: ["writer/references/a.md"] },
    { type: "skill.resolve", skillName: "writer" },
    { type: "reference.resolve", virtualPath: "writer/references/a.md" }
  ])("rejects $type from a z.ai document without a real tab", async (request) => {
    await replaceSkill(packageWithReferences("writer", { "references/a.md": "alpha" }));

    const response = await handleRuntimeRequest(request, {
      id: EXTENSION_ID,
      url: "https://chat.z.ai/"
    });

    expect(response.ok).toBe(false);
  });

  it.each([
    ["an unrelated website", { id: EXTENSION_ID, url: "https://example.com/", tab: { id: 7 } as chrome.tabs.Tab }],
    ["a z.ai document without a real tab", { id: EXTENSION_ID, url: "https://chat.z.ai/" }]
  ])("rejects read requests from %s", async (_label, sender) => {
    const response = await handleRuntimeRequest({ type: "catalog.get" }, sender);

    expect(response).toEqual({ ok: false, error: "当前页面不能读取 Skill 目录。" });
  });

  it.each([
    ["an options-page sender", { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/options.html` }, ["writer"]],
    ["an unknown Skill", deepSeekSender(), ["missing"]],
    ["duplicate names", deepSeekSender(), ["writer", "writer"]]
  ])("rejects Skill batch reads from or containing %s", async (_label, sender, skillNames) => {
    await replaceSkill(packageFor("writer"));

    const response = await handleRuntimeRequest({ type: "skill.readBatch", skillNames }, sender);

    expect(response.ok).toBe(false);
  });

  it("rejects the whole batch when one Skill has no persisted SKILL.md", async () => {
    await replaceSkill(packageFor("writer"));
    await replaceSkill(packageFor("eval-design"));
    const database = await openSkillDatabase();
    await database.delete("skillFiles", ["eval-design", "SKILL.md"]);

    const response = await handleRuntimeRequest(
      { type: "skill.readBatch", skillNames: ["writer", "eval-design"] },
      deepSeekSender()
    );

    expect(response).toEqual({ ok: false, error: "Skill「eval-design」缺少有效的使用说明。" });
    expect(response).not.toHaveProperty("data");
  });

  it("rejects the whole batch when SKILL.md content exceeds the task limit", async () => {
    await replaceSkill(packageFor("large", "x".repeat(200 * 1024 + 1)));

    const response = await handleRuntimeRequest(
      { type: "skill.readBatch", skillNames: ["large"] },
      deepSeekSender()
    );

    expect(response).toEqual({ ok: false, error: "这批 Skill 内容超过 200 KiB 限制。" });
    expect(response).not.toHaveProperty("data");
  });

  it("reads an ordered Reference batch belonging to selected Skills", async () => {
    await replaceSkill(packageWithReferences("writer", {
      "references/a.md": "alpha",
      "references/b.md": "beta"
    }));

    const response = await handleRuntimeRequest({
      type: "reference.readBatch",
      selectedSkillNames: ["writer"],
      virtualPaths: ["writer/references/b.md", "writer/references/a.md"]
    }, deepSeekSender());

    expect(response).toEqual({ ok: true, data: [
      { virtualPath: "writer/references/b.md", content: "beta", byteLength: 4 },
      { virtualPath: "writer/references/a.md", content: "alpha", byteLength: 5 }
    ] });
  });

  it.each([
    ["an options sender", { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/options.html` }, ["writer"], ["writer/references/a.md"]],
    ["an unselected Skill", deepSeekSender(), ["other"], ["writer/references/a.md"]],
    ["a duplicate path", deepSeekSender(), ["writer"], ["writer/references/a.md", "writer/references/a.md"]],
    ["path traversal", deepSeekSender(), ["writer"], ["writer/references/../a.md"]],
    ["a backslash", deepSeekSender(), ["writer"], ["writer/references\\a.md"]],
    ["a path outside references", deepSeekSender(), ["writer"], ["writer/SKILL.md"]]
  ])("rejects Reference batches containing %s", async (_label, sender, selectedSkillNames, virtualPaths) => {
    await replaceSkill(packageWithReferences("writer", { "references/a.md": "alpha" }));

    const response = await handleRuntimeRequest({
      type: "reference.readBatch",
      selectedSkillNames,
      virtualPaths
    }, sender);

    expect(response.ok).toBe(false);
    expect(response).not.toHaveProperty("data");
  });

  it("rejects the whole Reference batch when one file is absent", async () => {
    await replaceSkill(packageWithReferences("writer", { "references/a.md": "alpha" }));

    const response = await handleRuntimeRequest({
      type: "reference.readBatch",
      selectedSkillNames: ["writer"],
      virtualPaths: ["writer/references/a.md", "writer/references/missing.md"]
    }, deepSeekSender());

    expect(response.ok).toBe(false);
    expect(response).not.toHaveProperty("data");
  });

  it("counts selected SKILL.md and Reference bytes together against the task limit", async () => {
    await replaceSkill(packageWithReferences("writer", {
      "references/large.md": "x".repeat(200 * 1024)
    }));

    const response = await handleRuntimeRequest({
      type: "reference.readBatch",
      selectedSkillNames: ["writer"],
      virtualPaths: ["writer/references/large.md"]
    }, deepSeekSender());

    expect(response).toEqual({ ok: false, error: "这次任务回注内容超过 200 KiB 限制。" });
  });
});

function deepSeekSender(): chrome.runtime.MessageSender {
  return { id: EXTENSION_ID, url: "https://chat.deepseek.com/a/chat/s/test", tab: { id: 7 } as chrome.tabs.Tab };
}

function optionsSender(hash = ""): chrome.runtime.MessageSender {
  return { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/options.html${hash}` };
}

function zaiSender(): chrome.runtime.MessageSender {
  return { id: EXTENSION_ID, url: "https://chat.z.ai/c/test", tab: { id: 8 } as chrome.tabs.Tab };
}

function mcpDetails(serverName: string, summary = `summary-${serverName}`): McpServiceDetails {
  return {
    serverName,
    instructions: "Weather tools",
    tools: [{ name: "current", description: "Current weather", inputSchema: {} }],
    protocolEra: "modern",
    detailSummary: summary,
    detailBytes: 100
  };
}

function packageFor(name: string, contentOverride?: string): SkillPackage {
  const content = contentOverride ?? `---\nname: ${name}\ndescription: Test\n---\n`;
  const byteLength = new TextEncoder().encode(content).byteLength;
  return {
    metadata: {
      name,
      description: "Test",
      referenceCount: 0,
      packageBytes: byteLength,
      savedBytes: byteLength,
      ignoredEntryCount: 0,
      importedAt: "2026-07-28T00:00:00.000Z"
    },
    files: [{ skillName: name, virtualPath: "SKILL.md", kind: "skill", content, byteLength }]
  };
}

function packageWithReferences(name: string, references: Record<string, string>): SkillPackage {
  const skillPackage = packageFor(name);
  const referenceFiles = Object.entries(references).map(([virtualPath, content]) => ({
    skillName: name,
    virtualPath,
    kind: "reference" as const,
    content,
    byteLength: new TextEncoder().encode(content).byteLength
  }));
  const referenceBytes = referenceFiles.reduce((total, file) => total + file.byteLength, 0);
  skillPackage.files.push(...referenceFiles);
  skillPackage.metadata.referenceCount = referenceFiles.length;
  skillPackage.metadata.savedBytes += referenceBytes;
  skillPackage.metadata.packageBytes += referenceBytes;
  return skillPackage;
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
