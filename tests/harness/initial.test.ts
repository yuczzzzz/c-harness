import { buildInitialHarness } from "@/harness/initial";
import { emptySessionToolKnowledgeState } from "@/deepseek/session-tool-knowledge";
import type { SkillMetadata } from "@/skills/contracts";

describe("initial harness", () => {
  it("preserves the original question and closes the protocol immediately before it", () => {
    const question = "第一行\n\n```txt\n保留原样\n```";
    const harness = buildInitialHarness([], question);

    expect(harness).toContain("（当前没有已导入的 Skill）");
    expect(harness.endsWith(`约定到这里。不用复述或确认，直接处理我这次的问题：\n\n${question}`)).toBe(true);
  });

  it("lists valid DeepSeek session knowledge without repeating resource bodies", () => {
    const state = emptySessionToolKnowledgeState();
    state.skills.set("writer", "digest-a");
    state.references.set("writer/references/style.md", "digest-b");

    const harness = buildInitialHarness([], "问题", state);

    expect(harness).toContain("本会话已经读取：");
    expect(harness).toContain("- Skill：writer");
    expect(harness).toContain("- Reference：writer/references/style.md");
    expect(harness).not.toContain("digest-a");
    expect(harness).not.toContain("digest-b");
  });

  it("explicitly discloses an empty DeepSeek session knowledge state", () => {
    const harness = buildInitialHarness([], "问题", emptySessionToolKnowledgeState());
    expect(harness).toContain("- Skill：（尚未读取）");
    expect(harness).toContain("- Reference：（尚未读取）");
  });

  it("lists every Skill in catalog order", () => {
    const harness = buildInitialHarness([
      metadataFor("writing", "写作支持"),
      metadataFor("review", "代码审查")
    ], "问题");

    expect(harness.indexOf("- writing：写作支持")).toBeLessThan(harness.indexOf("- review：代码审查"));
    expect(harness).toContain("```skill\nname: skill-name\n```");
    expect(harness).toContain("```read\npath: skill-name/references/file.md\n```");
  });

  it("lists MCP catalog and disclosed state without endpoint or tool schemas", () => {
    const harness = buildInitialHarness([], "问题", undefined, [{
      serviceId: "weather",
      serverName: "weather",
      displayName: "Weather Tools",
      description: "天气查询",
      toolCount: 2
    }], [{
      serviceId: "weather",
      displayName: "Weather Tools",
      detailSummary: "abcdef1234567890",
      disclosedAt: "2026-08-03T00:00:00.000Z"
    }]);

    expect(harness).toContain("```mcp\nserver: service-id\n```");
    expect(harness).toContain("```mcp-call");
    expect(harness).toContain("多行字符串必须使用 YAML 块标量 `|`");
    expect(harness).toContain("禁止在单引号或双引号字符串中直接换行");
    expect(harness).toContain("arguments:\n  command: |\n    first command\n    second command");
    expect(harness).toContain("- weather：Weather Tools；天气查询；2 个 Tool");
    expect(harness).toContain("- weather：Weather Tools；摘要 abcdef123456");
    expect(harness).not.toContain("必须先执行命令查询本地开发环境情况");
    expect(harness).not.toContain("http://127.0.0.1:3000/mcp");
    expect(harness).not.toContain("inputSchema");
  });

  it("builds an MCP-only harness when Skill is disabled", () => {
    const harness = buildInitialHarness([
      metadataFor("writing", "写作支持")
    ], "问题", emptySessionToolKnowledgeState(), [{
      serviceId: "weather",
      serverName: "weather",
      displayName: "Weather Tools",
      description: "天气查询",
      toolCount: 1
    }], [], { skillEnabled: false, mcpEnabled: true });

    expect(harness).toContain("当前 MCP 服务目录：");
    expect(harness).toContain("- weather：Weather Tools；天气查询；1 个 Tool");
    expect(harness).toContain("```mcp\nserver: service-id\n```");
    expect(harness).not.toContain("```skill");
    expect(harness).not.toContain("```read");
    expect(harness).not.toContain("当前 Skill 目录");
    expect(harness).not.toContain("writing");
    expect(harness).not.toContain("本会话已经读取");
  });

  it("builds a Skill-only harness when MCP is disabled", () => {
    const harness = buildInitialHarness([
      metadataFor("writing", "写作支持")
    ], "问题", undefined, [{
      serviceId: "weather",
      serverName: "weather",
      displayName: "Weather Tools",
      description: "天气查询",
      toolCount: 1
    }], [], { skillEnabled: true, mcpEnabled: false });

    expect(harness).toContain("当前 Skill 目录：");
    expect(harness).toContain("- writing：写作支持");
    expect(harness).toContain("```skill\nname: skill-name\n```");
    expect(harness).toContain("```read\npath: skill-name/references/file.md\n```");
    expect(harness).not.toContain("当前 MCP 服务目录");
    expect(harness).not.toContain("```mcp");
    expect(harness).not.toContain("weather");
  });

  it("adds the local environment prompt without exposing endpoint or schemas", () => {
    const harness = buildInitialHarness([
      metadataFor("writer", "写作支持")
    ], "问题", undefined, [{
      serviceId: "codexpro-local",
      serverName: "CodexPro",
      serverTitle: "CodexPro Local",
      displayName: "CodexPro Local",
      description: "本地工作区",
      toolCount: 3
    }], [], { skillEnabled: true, mcpEnabled: true });

    expect(harness).toContain("使用CodexPro Local从本地环境获取。");
    expect(harness).toContain("需要通过 bash 执行命令时，必须先执行命令查询本地开发环境情况");
    expect(harness).toContain("一次尽可能查询多种工具");
    expect(harness).toContain("如果本地开发环境能够满足需求, 则直接执行对应命令");
    expect(harness).toContain("只有本地开发环境无法满足需求时，才向我确认是否安装其他程序；得到确认前不得安装");
    expect(harness).toContain("在获取任何 Skill 前，必须先与我确认 Skill 来源");
    expect(harness).not.toContain("http://127.0.0.1:3000/mcp");
    expect(harness).not.toContain("inputSchema");
  });
});

function metadataFor(name: string, description: string): SkillMetadata {
  return {
    name,
    description,
    referenceCount: 0,
    packageBytes: 1,
    savedBytes: 1,
    ignoredEntryCount: 0,
    importedAt: "2026-07-28T00:00:00.000Z"
  };
}
