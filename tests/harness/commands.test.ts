import {
  formatBatchCorrection,
  formatFinalAnswerCorrection,
  formatProgressiveBatchCorrection,
  formatReferenceBatch,
  formatSkillBatch,
  parseCommandBatch
} from "@/harness/commands";

describe("parseCommandBatch", () => {
  it("keeps multiple skill requests in reply order", () => {
    expect(parseCommandBatch("先读取：\n```skill\nname: writer\n```\n再读取：\n```skill\nname: eval-design\n```"))
      .toEqual({ kind: "skill", requests: ["writer", "eval-design"] });
  });

  it("keeps multiple read requests in reply order", () => {
    expect(parseCommandBatch("```read\npath: writer/references/a.md\n```\n```read\npath: writer/references/b.md\n```"))
      .toEqual({
        kind: "read",
        requests: ["writer/references/a.md", "writer/references/b.md"]
      });
  });

  it("keeps multiple mcp requests in reply order", () => {
    expect(parseCommandBatch("```mcp\nserver: weather\n```\n```mcp\nserver: memory-server\n```"))
      .toEqual({ kind: "mcp", requests: ["weather", "memory-server"] });
  });

  it("parses one mcp-call request with nested YAML mapping arguments", () => {
    expect(parseCommandBatch([
      "```mcp-call",
      "server: weather",
      "tool: current-weather",
      "arguments:",
      "  city: Shanghai",
      "  unit: celsius",
      "  nested:",
      "    safeInteger: 9007199254740991",
      "    enabled: true",
      "    empty: null",
      "```"
    ].join("\n"))).toEqual({
      kind: "mcp-call",
      request: {
        serviceId: "weather",
        toolName: "current-weather",
        arguments: {
          city: "Shanghai",
          unit: "celsius",
          nested: {
            safeInteger: 9007199254740991,
            enabled: true,
            empty: null
          }
        }
      }
    });
  });

  it("allows YAML field order changes", () => {
    expect(parseCommandBatch("```mcp-call\narguments:\n  city: Shanghai\ntool: current-weather\nserver: weather\n```"))
      .toEqual({
        kind: "mcp-call",
        request: {
          serviceId: "weather",
          toolName: "current-weather",
          arguments: { city: "Shanghai" }
        }
      });
  });

  it("ignores prose, unlabeled fences, and unknown labels", () => {
    expect(parseCommandBatch("说明\n```\nwriter\n```\n```json\n{}\n```"))
      .toEqual({ kind: "none" });
  });

  it.each([
    ["mixed labels", "```skill\nname: writer\n```\n```read\npath: writer/references/a.md\n```", "MIXED_LABELS"],
    ["mixed mcp and skill labels", "```mcp\nserver: weather\n```\n```skill\nname: writer\n```", "MIXED_LABELS"],
    ["mixed mcp-call and mcp labels", "```mcp-call\nserver: weather\ntool: current-weather\narguments: {}\n```\n```mcp\nserver: weather\n```", "MIXED_LABELS"],
    ["two mcp-call requests", "```mcp-call\nserver: weather\ntool: current-weather\narguments: {}\n```\n```mcp-call\nserver: weather\ntool: current-weather\narguments: {}\n```", "MALFORMED_BODY"],
    ["duplicate requests", "```skill\nname: writer\n```\n```skill\nname: writer\n```", "DUPLICATE_REQUEST"],
    ["duplicate mcp requests", "```mcp\nserver: weather\n```\n```mcp\nserver: weather\n```", "DUPLICATE_REQUEST"],
    ["empty body", "```skill\n\n```", "MALFORMED_BODY"],
    ["unclosed known fence", "```skill\nwriter", "UNCLOSED_FENCE"]
  ])("rejects %s", (_label, reply, code) => {
    expect(parseCommandBatch(reply)).toEqual({ kind: "invalid", code });
  });

  it.each([
    ["old single-line body", "```skill\nwriter\n```"],
    ["old slash-delimited fields", "```mcp-call\n//////////////// server\nweather\n//////////////// tool\ncurrent-weather\n//////////////// arguments\n{}\n```"],
    ["non-mapping body", "```skill\n- writer\n```"],
    ["multiple YAML documents", "```skill\n---\nname: writer\n---\nname: eval-design\n```"],
    ["alias", "```skill\nname: *writer\n```"],
    ["anchor", "```skill\nname: &writer writer\n```"],
    ["explicit tag", "```skill\nname: !custom writer\n```"],
    ["merge key in arguments", "```mcp-call\nserver: weather\ntool: current-weather\narguments:\n  <<: { city: Shanghai }\n```"],
    ["duplicate YAML key", "```skill\nname: writer\nname: eval-design\n```"],
    ["unknown key", "```skill\nname: writer\nextra: true\n```"],
    ["missing key", "```read\nname: writer\n```"],
    ["empty string", "```mcp\nserver: ''\n```"],
    ["multiline string", "```skill\nname: |-\n  writer\n  eval\n```"],
    ["array arguments", "```mcp-call\nserver: weather\ntool: current-weather\narguments:\n  cities:\n    - Shanghai\n```"],
    ["non-finite number", "```mcp-call\nserver: weather\ntool: current-weather\narguments:\n  value: .nan\n```"],
    ["unsafe integer", "```mcp-call\nserver: weather\ntool: current-weather\narguments:\n  value: 9007199254740992\n```"]
  ])("rejects malformed YAML command: %s", (_label, reply) => {
    expect(parseCommandBatch(reply)).toEqual({ kind: "invalid", code: "MALFORMED_BODY" });
  });
});
describe("formatSkillBatch", () => {
  it("numbers results and uses a fence longer than any content run", () => {
    const content = "保留开头\n````\n保留结尾\n";
    const feedback = formatSkillBatch([
      { skillName: "writer", content, byteLength: new TextEncoder().encode(content).byteLength }
    ]);

    expect(feedback).toContain("我把你需要的 Skill 使用说明都放在下面了：");
    expect(feedback).toContain("1. Skill：writer");
    expect(feedback).toContain(`\`\`\`\`\`\n${content}\`\`\`\`\``);
  });
});

describe("formatReferenceBatch", () => {
  it("numbers full virtual paths and preserves content with a dynamic fence", () => {
    const content = "first\n```\nlast";
    const feedback = formatReferenceBatch([{
      virtualPath: "writer/references/checklist.md",
      content,
      byteLength: new TextEncoder().encode(content).byteLength
    }]);

    expect(feedback).toContain("我把你需要的参考资料都放在下面了：");
    expect(feedback).toContain("1. Reference：writer/references/checklist.md");
    expect(feedback).toContain(`\`\`\`\`\n${content}\n\`\`\`\``);
  });
});

describe("correction feedback", () => {
  it("uses the fixed Skill and Reference batch wording with a concrete error", () => {
    expect(formatBatchCorrection("skill", "请求了未知 Skill。"))
      .toBe("这批 skill 请求的写法不对，我没有读取。请按前面的格式整批重新发给我。\n\n具体错误：请求了未知 Skill。");
    expect(formatBatchCorrection("read", "路径不存在。"))
      .toBe("这批 read 请求的写法不对，我没有读取。请按前面的格式整批重新发给我。\n\n具体错误：路径不存在。");
  });

  it("uses a fixed final-answer correction that does not invite more reads", () => {
    expect(formatFinalAnswerCorrection())
      .toBe("资料已经全部提供，请不要再发读取请求，直接根据现有内容回答问题。");
  });

  it("uses a combined correction when progressive mode cannot identify one request kind", () => {
    expect(formatProgressiveBatchCorrection("请求批次错误：MIXED_LABELS"))
      .toContain("这批 skill/read 请求的写法不对，我没有读取。");
  });
});
