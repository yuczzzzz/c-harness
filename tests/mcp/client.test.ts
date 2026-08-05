import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { z } from "zod";

import { callMcpEndpointTool, discoverMcpEndpoint } from "@/mcp/client";

describe("discoverMcpEndpoint", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await closeServer(server);
    server = undefined;
  });

  it("reads the full Tool catalog through the official Streamable HTTP SDK", async () => {
    ({ server } = await startMcpServer({ toolCount: 2 }));

    const details = await discoverMcpEndpoint(endpointFor(server));

    expect(details.serverName).toBe("test-mcp");
    expect(details.serverVersion).toBe("1.0.0");
    expect(details.tools.map((tool) => tool.name)).toEqual(["tool-0", "tool-1"]);
    expect(details.protocolEra).toMatch(/^(modern|legacy)$/u);
    expect(details.detailSummary).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("calls a Tool and returns text content through the official Streamable HTTP SDK", async () => {
    ({ server } = await startMcpServer({ toolCount: 1 }));

    const result = await callMcpEndpointTool(endpointFor(server), "test-mcp", "summary", "tool-0", { value: "hello" });

    expect(result).toEqual({
      serviceId: "test-mcp",
      toolName: "tool-0",
      content: "hello",
      contentType: "text",
      isError: false,
      detailSummary: "summary"
    });
  });

  it("prefers structured content and serializes it as stable YAML", async () => {
    ({ server } = await startMcpServer({ toolCount: 1, structuredContent: true }));

    const result = await callMcpEndpointTool(endpointFor(server), "test-mcp", "summary", "tool-0", { value: "hello" });

    expect(result).toEqual({
      serviceId: "test-mcp",
      toolName: "tool-0",
      content: "result:\n  count: 2\n  value: hello",
      contentType: "yaml",
      isError: false,
      detailSummary: "summary"
    });
  });

  it("rejects services without Tools", async () => {
    ({ server } = await startMcpServer({ toolCount: 0 }));

    await expect(discoverMcpEndpoint(endpointFor(server))).rejects.toThrow("MCP 服务未提供 Tool。");
  });

  it("rejects services above the fixed Tool limit", async () => {
    ({ server } = await startMcpServer({ toolCount: 201 }));

    await expect(discoverMcpEndpoint(endpointFor(server))).rejects.toThrow("MCP 服务最多支持 200 个 Tool。");
  });
});

async function startMcpServer({
  toolCount,
  structuredContent = false
}: {
  toolCount: number;
  structuredContent?: boolean;
}): Promise<{ server: Server }> {
  const mcpServer = new McpServer({
    name: "test-mcp",
    version: "1.0.0"
  }, {
    instructions: "Use test tools only."
  });
  for (let index = 0; index < toolCount; index += 1) {
    mcpServer.registerTool(
      `tool-${index}`,
      {
        title: `Tool ${index}`,
        description: `Test tool ${index}`,
        inputSchema: { value: z.string() },
        ...(structuredContent ? { outputSchema: { result: z.object({ value: z.string(), count: z.number() }) } } : {})
      },
      ({ value }) => structuredContent
        ? {
            content: [{ type: "text" as const, text: `fallback: ${value}` }],
            structuredContent: { result: { value, count: 2 } }
          }
        : { content: [{ type: "text" as const, text: value }] }
    );
  }
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcpServer.connect(transport);

  const server = createServer((request, response) => {
    if (request.url !== "/mcp") {
      response.writeHead(404);
      response.end();
      return;
    }
    void transport.handleRequest(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return { server };
}

function endpointFor(server: Server | undefined): string {
  const address = server?.address();
  if (!address || typeof address === "string") throw new Error("测试 MCP 服务未启动。");
  return `http://127.0.0.1:${(address as AddressInfo).port}/mcp`;
}

function closeServer(server: Server | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
