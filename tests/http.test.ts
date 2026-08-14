import assert from "node:assert/strict";
import childProcess from "node:child_process";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const port = 4800 + (process.pid % 1000);

test("HTTP runtime exposes health and MCP tools", async () => {
  const child = childProcess.spawn(process.execPath, ["dist/src/index.js", "--http"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CONSTANTX_MCP_MODE: "http",
      CONSTANTX_MCP_HOST: "127.0.0.1",
      CONSTANTX_MCP_PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealth(port);
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.service, "ConstantX");
    assert.equal(health.version, "0.1.3");
    assert.equal(health.endpoint, `http://127.0.0.1:${port}/mcp`);
    assert.equal(health.pid, child.pid);

    const getMcp = await fetch(`http://127.0.0.1:${port}/mcp`);
    assert.equal(getMcp.status, 405);

    const client = new Client({ name: "constantx-http-test", version: "0.1.3" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "workflow.start_project"));
    assert.ok(tools.tools.some((tool) => tool.name === "workflow.implement"));
    await client.close();
  } finally {
    child.kill();
  }
});

async function waitForHealth(port: number): Promise<void> {
  const started = Date.now();
  let lastError = "not ready";
  while (Date.now() - started < 8000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`ConstantX HTTP runtime did not become healthy: ${lastError}`);
}