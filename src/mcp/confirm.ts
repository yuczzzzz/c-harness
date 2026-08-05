import type { McpToolCallRequest } from "@/mcp/contracts";
import type { McpToolCallDecision } from "@/mcp/task-coordinator";

/** 在当前页面显示 MCP Tool 调用确认覆盖层，并返回用户选择。 */
export function confirmMcpToolCall(
  request: McpToolCallRequest,
  pageDocument: Document = document
): Promise<McpToolCallDecision> {
  return new Promise((resolve) => {
    const overlay = pageDocument.createElement("div");
    overlay.className = "c-harness-mcp-confirm";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(15, 23, 42, 0.42)",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    });

    const panel = pageDocument.createElement("section");
    Object.assign(panel.style, {
      width: "min(560px, calc(100vw - 32px))",
      borderRadius: "8px",
      background: "#ffffff",
      color: "#111827",
      boxShadow: "0 24px 80px rgba(15, 23, 42, 0.28)",
      padding: "20px",
      display: "grid",
      gap: "14px"
    });

    const title = pageDocument.createElement("h2");
    title.textContent = "确认 MCP Tool 调用";
    Object.assign(title.style, { margin: "0", fontSize: "18px", lineHeight: "24px" });

    const summary = pageDocument.createElement("p");
    summary.textContent = `服务：${request.serviceId}；Tool：${request.toolName}`;
    Object.assign(summary.style, { margin: "0", fontSize: "14px", lineHeight: "20px" });

    const args = pageDocument.createElement("pre");
    args.textContent = stableJson(request.arguments);
    Object.assign(args.style, {
      margin: "0",
      maxHeight: "260px",
      overflow: "auto",
      borderRadius: "6px",
      background: "#f3f4f6",
      padding: "12px",
      fontSize: "12px",
      lineHeight: "18px",
      whiteSpace: "pre-wrap"
    });

    const actions = pageDocument.createElement("div");
    Object.assign(actions.style, { display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" });
    const deny = button(pageDocument, "拒绝");
    const allowOnce = button(pageDocument, "仅本次允许");
    const trustSession = button(pageDocument, "信任当前会话并允许", true);
    actions.append(deny, allowOnce, trustSession);
    panel.append(title, summary, args, actions);
    overlay.append(panel);

    const done = (decision: McpToolCallDecision): void => {
      overlay.remove();
      resolve(decision);
    };
    deny.addEventListener("click", () => done("deny"), { once: true });
    allowOnce.addEventListener("click", () => done("allow_once"), { once: true });
    trustSession.addEventListener("click", () => done("trust_session"), { once: true });
    pageDocument.body.append(overlay);
  });
}

function button(pageDocument: Document, label: string, primary = false): HTMLButtonElement {
  const element = pageDocument.createElement("button");
  element.type = "button";
  element.textContent = label;
  Object.assign(element.style, {
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    background: primary ? "#111827" : "#ffffff",
    color: primary ? "#ffffff" : "#111827",
    padding: "8px 12px",
    fontSize: "14px",
    lineHeight: "20px",
    cursor: "pointer"
  });
  return element;
}

function stableJson(value: unknown): string {
  return stableStringify(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(",")}}`;
}
