#!/usr/bin/env node
import http from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPlannerServer } from "./server.js";
import { configuredAllowedProjectRoots } from "./utils.js";

const SERVICE_NAME = "ConstantX";
const SERVICE_VERSION = "0.1.5";
const startedAt = new Date();

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
  const mcpEndpoint = `http://${host}:${port}/mcp`;
  const httpServer = http.createServer(async (req, res) => {
    if (req.url?.startsWith("/health")) {
      if (req.method !== "GET") {
        res.writeHead(405, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        pid: process.pid,
        startedAt: startedAt.toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        status: "ready",
        endpoint: mcpEndpoint,
        allowedProjectRoots: configuredAllowedProjectRoots()
      }));
      return;
    }

    if (!req.url?.startsWith("/mcp")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null
      }));
      return;
    }

    const server = createPlannerServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      res.on("close", () => {
        transport.close().catch(() => undefined);
        server.close().catch(() => undefined);
      });
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling ConstantX MCP HTTP request:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
        id: null
      }));
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  console.error(`ConstantX running on ${mcpEndpoint}`);
}

main().catch((error) => {
  console.error("Fatal error in ConstantX:", error);
  process.exit(1);
});