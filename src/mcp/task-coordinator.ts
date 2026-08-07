import type { McpServiceDetails, McpToolCallResult, McpToolCallRequest } from "@/mcp/contracts";
import { formatMcpDetailsBatch } from "@/mcp/format";

export type McpToolCallDecision = "allow_once" | "trust_session" | "deny";

export interface McpTaskCoordinatorDeps {
  readDetailsBatch(serviceIds: string[]): Promise<Array<{ serviceId: string; details: McpServiceDetails }>>;
  commitDisclosures(serviceIds: string[]): Promise<void>;
  hasSessionTrust?(serviceId: string): Promise<boolean>;
  commitSessionTrust?(serviceId: string): Promise<void>;
  confirmToolCall?(request: McpToolCallRequest): Promise<McpToolCallDecision>;
  callTool?(request: McpToolCallRequest): Promise<McpToolCallResult>;
}

export interface McpTaskCoordinatorOutput {
  message: string;
  serviceIds: string[];
}

export type McpToolCallOutcome =
  | { kind: "denied" }
  | { kind: "executed"; prompted: boolean; result: McpToolCallResult };

/** 协调 MCP 详情披露，统一执行读取、提交和反馈格式化。 */
export class McpTaskCoordinator {
  constructor(private readonly deps: McpTaskCoordinatorDeps) {}

  /** 读取一批 MCP 服务详情，成功回注后提交当前会话披露状态。 */
  async readDetails(serviceIds: string[]): Promise<McpTaskCoordinatorOutput> {
    const details = await this.deps.readDetailsBatch(serviceIds);
    return {
      message: formatMcpDetailsBatch(details),
      serviceIds: details.map((item) => item.serviceId)
    };
  }

  /** 在必要时请求用户确认，然后调用已披露的 MCP Tool。 */
  async callTool(request: McpToolCallRequest): Promise<McpToolCallOutcome> {
    if (!this.deps.callTool) throw new Error("当前页面不能调用 MCP Tool。");
    const trusted = await this.deps.hasSessionTrust?.(request.serviceId) ?? false;
    let prompted = false;
    if (!trusted) {
      prompted = true;
      const decision = await this.deps.confirmToolCall?.(request) ?? "deny";
      if (decision === "deny") return { kind: "denied" };
      if (decision === "trust_session") await this.deps.commitSessionTrust?.(request.serviceId);
    }
    return { kind: "executed", prompted, result: await this.deps.callTool(request) };
  }
}
