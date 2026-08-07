import { confirmMcpToolCall } from "@/mcp/confirm";

describe("confirmMcpToolCall", () => {
  it("removes the confirmation dialog after the user denies the call", async () => {
    const decision = confirmMcpToolCall({
      serviceId: "weather",
      toolName: "current-weather",
      arguments: { city: "Shanghai" }
    }, document);

    document.querySelector<HTMLButtonElement>(".c-harness-mcp-confirm button")?.click();

    await expect(decision).resolves.toBe("deny");
    expect(document.querySelector(".c-harness-mcp-confirm")).toBeNull();
  });
});
