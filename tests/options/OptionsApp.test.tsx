import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { OptionsApp } from "@/options/OptionsApp";
import type { McpServiceClient, SkillLibraryClient } from "@/options/client";
import type { GeneralSettingsClient } from "@/options/client";
import type { McpServiceRecord } from "@/mcp/contracts";
import type { SkillMetadata, SkillPackage } from "@/skills/contracts";
import { createTestZip, validSkillMarkdown } from "@tests/helpers/zip";

describe("OptionsApp", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "#/");
  });

  it("shows the settings home and navigates to secondary pages", async () => {
    const user = userEvent.setup();
    render(<OptionsApp client={clientFor([])} mcpClient={mcpClientFor([])} />);

    expect(screen.getByRole("heading", { name: "设置" })).toBeVisible();
    expect(screen.getByRole("link", { name: /通用设置/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /Skill 管理/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /MCP 管理/ })).toBeVisible();
    expect(screen.getByText("调整通用扩展行为")).toBeVisible();
    expect(screen.getByText("扩展提供的 Skill 功能，支持导入本地 Skill 压缩包")).toBeVisible();
    expect(screen.getByText("添加和检测 MCP 服务")).toBeVisible();
    await user.click(screen.getByRole("link", { name: /通用设置/ }));
    expect(await screen.findByRole("heading", { name: "通用设置" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "自动回注时间" })).toBeVisible();

    await user.click(screen.getByRole("link", { name: "返回设置" }));
    expect(await screen.findByRole("heading", { name: "设置" })).toBeVisible();

    await user.click(screen.getByRole("link", { name: /Skill 管理/ }));
    expect(await screen.findByRole("heading", { name: "Skill 管理" })).toBeVisible();

    await user.click(screen.getByRole("link", { name: "返回设置" }));
    expect(await screen.findByRole("heading", { name: "设置" })).toBeVisible();

    await user.click(screen.getByRole("link", { name: /MCP 管理/ }));
    expect(await screen.findByRole("heading", { name: "MCP 管理" })).toBeVisible();
  });

  it("loads and saves the general reinjection delay settings", async () => {
    const user = userEvent.setup();
    const settingsClient = settingsClientFor(true, 2, 4);
    window.history.replaceState(null, "", "#/general");
    render(<OptionsApp client={clientFor([])} mcpClient={mcpClientFor([])} settingsClient={settingsClient} />);

    expect(await screen.findByRole("heading", { name: "通用设置" })).toBeVisible();
    const minInput = screen.getByRole("spinbutton", { name: "最小自动回注延迟（秒）" });
    const maxInput = screen.getByRole("spinbutton", { name: "最大自动回注延迟（秒）" });
    expect(minInput).toHaveValue(2);
    expect(maxInput).toHaveValue(4);

    await user.clear(minInput);
    await user.type(minInput, "5");
    await user.clear(maxInput);
    await user.type(maxInput, "5");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(settingsClient.updateReinjectionDelay).toHaveBeenCalledWith(5, 5));
    expect(await screen.findByRole("status")).toHaveTextContent("已保存。");
  });

  it("shows inline validation errors and does not partially save invalid general settings", async () => {
    const user = userEvent.setup();
    const settingsClient = settingsClientFor(true, 2, 4);
    window.history.replaceState(null, "", "#/general");
    render(<OptionsApp client={clientFor([])} mcpClient={mcpClientFor([])} settingsClient={settingsClient} />);

    const minInput = await screen.findByRole("spinbutton", { name: "最小自动回注延迟（秒）" });
    const maxInput = screen.getByRole("spinbutton", { name: "最大自动回注延迟（秒）" });
    await user.clear(minInput);
    await user.type(minInput, "6");
    await user.clear(maxInput);
    await user.type(maxInput, "2");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("自动回注最小延迟不能大于最大延迟。");
    expect(settingsClient.updateReinjectionDelay).not.toHaveBeenCalled();
  });

  it("supports direct hash access and browser history navigation", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "#/skills");
    render(<OptionsApp client={clientFor([])} mcpClient={mcpClientFor([])} />);
    expect(await screen.findByRole("heading", { name: "Skill 管理" })).toBeVisible();

    await user.click(screen.getByRole("link", { name: "返回设置" }));
    expect(await screen.findByRole("heading", { name: "设置" })).toBeVisible();

    act(() => {
      window.history.back();
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(await screen.findByRole("heading", { name: "Skill 管理" })).toBeVisible();

    act(() => {
      window.history.forward();
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(await screen.findByRole("heading", { name: "设置" })).toBeVisible();
  });

  it("adds, redetects and deletes MCP services", async () => {
    const user = userEvent.setup();
    const services: McpServiceRecord[] = [];
    const mcpClient = mcpClientFor(services);
    window.history.replaceState(null, "", "#/mcp");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<OptionsApp client={clientFor([])} mcpClient={mcpClient} />);

    expect(await screen.findByText("尚未添加 MCP 服务")).toBeVisible();
    await user.type(screen.getByPlaceholderText("https://example.com/mcp 或 127.0.0.1:3000"), "127.0.0.1:3000");
    await user.click(screen.getByRole("button", { name: "添加" }));

    expect(await screen.findByText("weather")).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "状态" })).toBeVisible();
    expect(screen.getByText("可用")).toBeVisible();
    expect(screen.queryByRole("columnheader", { name: "协议" })).not.toBeInTheDocument();
    expect(screen.queryByText("Streamable HTTP")).not.toBeInTheDocument();
    expect(mcpClient.add).toHaveBeenCalledWith("127.0.0.1:3000");

    await user.click(screen.getByRole("button", { name: "重新检测 weather" }));
    await waitFor(() => expect(mcpClient.redetect).toHaveBeenCalledOnce());

    await user.click(screen.getByRole("button", { name: "删除 weather" }));
    await waitFor(() => expect(mcpClient.delete).toHaveBeenCalledWith("weather"));
    expect(await screen.findByText("尚未添加 MCP 服务")).toBeVisible();
  });

  it("shows checking and unavailable states around failed redetection", async () => {
    const user = userEvent.setup();
    const service = mcpRecord("weather", "http://127.0.0.1:3000/mcp");
    let rejectRedetection: ((error: Error) => void) | undefined;
    const client = mcpClientFor([service]);
    client.redetect.mockImplementation(() => new Promise((_, reject) => {
      rejectRedetection = reject;
    }));
    window.history.replaceState(null, "", "#/mcp");
    render(<OptionsApp client={clientFor([])} mcpClient={client} />);

    await screen.findByText("可用");
    await user.click(screen.getByRole("button", { name: "重新检测 weather" }));
    expect(screen.getByText("检测中")).toBeVisible();

    service.detectionStatus = "unavailable";
    service.lastDetectionAt = "2026-08-03T01:00:00.000Z";
    await act(async () => rejectRedetection?.(new Error("Failed to fetch")));

    expect(await screen.findByText("不可用")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to fetch");
  });

  it("warns when multiple local environment MCP services match and shows the selected service", async () => {
    window.history.replaceState(null, "", "#/mcp");
    render(<OptionsApp client={clientFor([])} mcpClient={mcpClientFor([
      mcpRecord("codex-b", "http://127.0.0.1:3001/mcp", { serverName: "codexpro", serverTitle: "Bravo" }),
      mcpRecord("codex-a", "http://127.0.0.1:3000/mcp", { serverName: "CodexPro", serverTitle: "Alpha" }),
      mcpRecord("weather", "http://127.0.0.1:3002/mcp", { serverName: "weather" })
    ])} />);

    expect(await screen.findByRole("heading", { name: "本地环境 MCP 命中多个服务" })).toBeVisible();
    expect(screen.getByText("当前 Harness 将使用 Alpha（codex-a）。")).toBeVisible();
    expect(screen.getAllByText("codex-a").length).toBeGreaterThan(0);
    expect(screen.getAllByText("codex-b").length).toBeGreaterThan(0);
    expect(screen.getByText("weather")).toBeVisible();
  });

  it("renders legacy MCP records returned by an older service worker", async () => {
    const legacyService = mcpRecord("weather", "http://127.0.0.1:3000/mcp") as Partial<McpServiceRecord>;
    delete legacyService.detectionStatus;
    delete legacyService.lastDetectionAt;
    window.history.replaceState(null, "", "#/mcp");

    render(<OptionsApp client={clientFor([])} mcpClient={mcpClientFor([legacyService as McpServiceRecord])} />);

    expect(await screen.findByText("可用")).toBeVisible();
    expect(screen.getByRole("cell", { name: /2026年8月3日/ })).toBeVisible();
  });

  it("imports a Skill and displays the refreshed catalog", async () => {
    const user = userEvent.setup();
    const catalog: SkillMetadata[] = [];
    const client = clientFor(catalog);
    renderSkillsPage(client);
    await screen.findByText("尚未导入 Skill");
    const zip = await createTestZip([
      { name: "SKILL.md", content: validSkillMarkdown() },
      { name: "references/checklist.md", content: "check" }
    ]);

    await user.upload(screen.getByLabelText("选择 ZIP", { selector: "input" }), zip);

    expect(await screen.findByText("已导入 eval-design，1 个 Reference。")).toBeVisible();
    expect(client.replace).toHaveBeenCalledOnce();
    expect(await screen.findByText("Design reliable evals")).toBeVisible();
  });

  it("disables the Skill feature switch for an empty library and keeps first import off", async () => {
    const user = userEvent.setup();
    const catalog: SkillMetadata[] = [];
    const client = clientFor(catalog);
    const settingsClient = settingsClientFor(false);
    renderSkillsPage(client, settingsClient);

    const switchInput = await screen.findByRole("checkbox", { name: /已停用/ });
    expect(switchInput).not.toBeChecked();
    expect(switchInput).toBeDisabled();

    const zip = await createTestZip([{ name: "SKILL.md", content: validSkillMarkdown() }]);
    await user.upload(screen.getByLabelText("选择 ZIP", { selector: "input" }), zip);

    await waitFor(() => expect(client.replace).toHaveBeenCalledOnce());
    expect(await screen.findByRole("checkbox", { name: /已停用/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /已停用/ })).toBeEnabled();
    expect(settingsClient.updateSkillEnabled).not.toHaveBeenCalled();
  });

  it("loads and saves the Skill feature switch when the library is non-empty", async () => {
    const user = userEvent.setup();
    const settingsClient = settingsClientFor(true);
    renderSkillsPage(clientFor([metadata("writer", "Write")]), settingsClient);

    const switchInput = await screen.findByRole("checkbox", { name: /已启用/ });
    expect(switchInput).toBeChecked();

    await user.click(switchInput);

    await waitFor(() => expect(settingsClient.updateSkillEnabled).toHaveBeenCalledWith(false));
    expect(await screen.findByRole("checkbox", { name: /已停用/ })).not.toBeChecked();
  });

  it("rolls the Skill feature switch back when saving fails", async () => {
    const user = userEvent.setup();
    const settingsClient = settingsClientFor(true);
    settingsClient.updateSkillEnabled.mockRejectedValueOnce(new Error("保存失败"));
    renderSkillsPage(clientFor([metadata("writer", "Write")]), settingsClient);

    const switchInput = await screen.findByRole("checkbox", { name: /已启用/ });
    await user.click(switchInput);

    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
    expect(screen.getByRole("checkbox", { name: /已启用/ })).toBeChecked();
  });

  it("keeps the original Skill when replacement is cancelled", async () => {
    const user = userEvent.setup();
    const catalog = [metadata("eval-design", "Original")];
    const client = clientFor(catalog);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderSkillsPage(client);
    await screen.findByText("Original");
    const zip = await createTestZip([{ name: "SKILL.md", content: validSkillMarkdown() }]);

    await user.upload(screen.getByLabelText("选择 ZIP", { selector: "input" }), zip);

    expect(await screen.findByText("已取消覆盖，原 Skill 保持不变。")).toBeVisible();
    expect(client.replace).not.toHaveBeenCalled();
  });

  it("deletes a confirmed Skill and refreshes the list", async () => {
    const user = userEvent.setup();
    const catalog = [metadata("writer", "Write clearly")];
    const client = clientFor(catalog);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSkillsPage(client);

    await user.click(await screen.findByRole("button", { name: "删除 writer" }));

    await waitFor(() => expect(client.delete).toHaveBeenCalledWith("writer"));
    await waitFor(() => expect(screen.queryByText("Write clearly")).not.toBeInTheDocument());
    expect(await screen.findByRole("checkbox", { name: /已停用/ })).toBeDisabled();
  });

  it("paginates Skills by five and filters by title or description", async () => {
    const user = userEvent.setup();
    const longDescription = "A long skill description that explains a deployment workflow with many exact operational details for release checks.";
    const catalog = [
      metadata("alpha", longDescription),
      metadata("bravo", "Write clearly"),
      metadata("charlie", "Review carefully"),
      metadata("delta", "Summarize notes"),
      metadata("echo", "Format docs"),
      metadata("foxtrot", "Investigate incidents")
    ];
    renderSkillsPage(clientFor(catalog));

    expect(await screen.findByText("alpha")).toBeVisible();
    expect(screen.getByTitle(longDescription)).not.toHaveTextContent(longDescription);
    expect(screen.getByTitle(longDescription).textContent?.endsWith("...")).toBe(true);
    expect(screen.queryByText("foxtrot")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("foxtrot")).toBeVisible();

    await user.clear(screen.getByRole("searchbox", { name: "搜索 Skill" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索 Skill" }), "deploy");
    expect(await screen.findByText("alpha")).toBeVisible();
    expect(screen.queryByText("foxtrot")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "搜索 Skill" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索 Skill" }), "  ALPHA   deployment ");
    expect(await screen.findByText("alpha")).toBeVisible();
    expect(screen.queryByText("foxtrot")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "搜索 Skill" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索 Skill" }), "fox");
    expect(await screen.findByText("foxtrot")).toBeVisible();
    expect(screen.queryByText("alpha")).not.toBeInTheDocument();
  });
});

function renderSkillsPage(client: SkillLibraryClient, settingsClient = settingsClientFor(true)) {
  window.history.replaceState(null, "", "#/skills");
  return render(<OptionsApp client={client} mcpClient={mcpClientFor([])} settingsClient={settingsClient} />);
}

function clientFor(catalog: SkillMetadata[]): SkillLibraryClient & {
  replace: ReturnType<typeof vi.fn<(skillPackage: SkillPackage) => Promise<void>>>;
  delete: ReturnType<typeof vi.fn<(skillName: string) => Promise<void>>>;
} {
  return {
    getCatalog: vi.fn(async () => [...catalog]),
    replace: vi.fn(async (skillPackage) => {
      const existing = catalog.findIndex((skill) => skill.name === skillPackage.metadata.name);
      if (existing >= 0) catalog.splice(existing, 1, skillPackage.metadata);
      else catalog.push(skillPackage.metadata);
    }),
    delete: vi.fn(async (skillName) => {
      const index = catalog.findIndex((skill) => skill.name === skillName);
      if (index >= 0) catalog.splice(index, 1);
    })
  };
}

function mcpClientFor(services: McpServiceRecord[]): McpServiceClient & {
  add: ReturnType<typeof vi.fn<(endpoint: string) => Promise<McpServiceRecord>>>;
  redetect: ReturnType<typeof vi.fn<(service: McpServiceRecord) => Promise<McpServiceRecord>>>;
  delete: ReturnType<typeof vi.fn<(serviceId: string) => Promise<McpServiceRecord | null>>>;
} {
  return {
    list: vi.fn(async () => [...services]),
    add: vi.fn(async (endpoint) => {
      const record = mcpRecord("weather", endpoint);
      services.push(record);
      return record;
    }),
    redetect: vi.fn(async (service) => {
      service.lastVerifiedAt = "2026-08-03T01:00:00.000Z";
      service.lastDetectionAt = "2026-08-03T01:00:00.000Z";
      service.detectionStatus = "available";
      return service;
    }),
    delete: vi.fn(async (serviceId) => {
      const index = services.findIndex((service) => service.serviceId === serviceId);
      if (index < 0) return null;
      const [deleted] = services.splice(index, 1);
      return deleted ?? null;
    })
  };
}

function settingsClientFor(skillEnabled: boolean, minSeconds = 1, maxSeconds = 3): GeneralSettingsClient & {
  get: ReturnType<typeof vi.fn<() => Promise<Awaited<ReturnType<GeneralSettingsClient["get"]>>>>>;
  updateSkillEnabled: ReturnType<typeof vi.fn<(skillEnabled: boolean) => Promise<Awaited<ReturnType<GeneralSettingsClient["get"]>>>>>;
  updateReinjectionDelay: ReturnType<typeof vi.fn<(minSeconds: number, maxSeconds: number) => Promise<Awaited<ReturnType<GeneralSettingsClient["get"]>>>>>;
} {
  let enabled = skillEnabled;
  let min = minSeconds;
  let max = maxSeconds;
  return {
    get: vi.fn(async () => ({
      skillEnabled: enabled,
      reinjectionDelayMinSeconds: min,
      reinjectionDelayMaxSeconds: max
    })),
    updateSkillEnabled: vi.fn(async (nextEnabled) => {
      enabled = nextEnabled;
      return {
        skillEnabled: enabled,
        reinjectionDelayMinSeconds: min,
        reinjectionDelayMaxSeconds: max
      };
    }),
    updateReinjectionDelay: vi.fn(async (nextMin, nextMax) => {
      min = nextMin;
      max = nextMax;
      return {
        skillEnabled: enabled,
        reinjectionDelayMinSeconds: min,
        reinjectionDelayMaxSeconds: max
      };
    })
  };
}

function mcpRecord(
  serviceId: string,
  endpoint: string,
  identity: { serverName?: string; serverTitle?: string } = {}
): McpServiceRecord {
  return {
    recordId: serviceId,
    serviceId,
    endpoint,
    permissionOrigin: "http://127.0.0.1:3000",
    serverName: identity.serverName ?? serviceId,
    serverTitle: identity.serverTitle,
    description: "Weather tools",
    toolCount: 1,
    detailSummary: "summary",
    protocolEra: "modern",
    addedAt: "2026-08-03T00:00:00.000Z",
    lastVerifiedAt: "2026-08-03T00:00:00.000Z",
    lastDetectionAt: "2026-08-03T00:00:00.000Z",
    detectionStatus: "available"
  };
}

function metadata(name: string, description: string): SkillMetadata {
  return {
    name,
    description,
    referenceCount: 0,
    packageBytes: 100,
    savedBytes: 80,
    ignoredEntryCount: 0,
    importedAt: "2026-07-28T00:00:00.000Z"
  };
}
