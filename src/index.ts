#!/usr/bin/env node
import http from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPlannerServer } from "./server.js";

async function main(): Promise<void> {
  const mode = process.argv.includes("--http") || process.env.CONSTANTX_MCP_MODE === "http" ? "http" : "stdio";
  if (mode === "http") {
    await startHttpServer();
    return;
  }

  const server = createPlannerServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ConstantX running on stdio");
}

async function startHttpServer(): Promise<void> {
  const host = process.env.CONSTANTX_MCP_HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.CONSTANTX_MCP_PORT ?? "4317", 10);
  const server = createPlannerServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  const httpServer = http.createServer(async (req, res) => {
    if (!req.url?.startsWith("/mcp")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  console.error(`ConstantX running on http://${host}:${port}/mcp`);
}

main().catch((error) => {
  console.error("Fatal error in ConstantX:", error);
  process.exit(1);
});