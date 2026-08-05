import { formatMcpToolCallResult } from "@/mcp/format";

describe("formatMcpToolCallResult", () => {
  it("refills structured Tool output in a YAML fence", () => {
    const feedback = formatMcpToolCallResult({
      serviceId: "weather",
      toolName: "forecast",
      content: "days:\n  - condition: clear\n    temperature: 26",
      contentType: "yaml",
      isError: false,
      detailSummary: "summary"
    });

    expect(feedback).toBe([
      "MCP Tool `weather/forecast` 返回结构化结果：",
      "",
      "```yaml",
      "days:",
      "  - condition: clear",
      "    temperature: 26",
      "```"
    ].join("\n"));
  });
});
