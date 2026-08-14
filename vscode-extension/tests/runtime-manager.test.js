const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const test = require("node:test");
const { endpoint, healthEndpoint, parseMcpPayload, normalizeAllowedProjectRoots, hasMissingAllowedProjectRoots, stageRuntimeRoot, runtimePaths } = require("../src/runtime-manager");

test("runtime endpoints use the configured shared HTTP address", () => {
  const settings = { host: "127.0.0.1", port: 4317 };
  assert.equal(endpoint(settings), "http://127.0.0.1:4317/mcp");
  assert.equal(healthEndpoint(settings), "http://127.0.0.1:4317/health");
});

test("parseMcpPayload parses plain JSON responses", () => {
  const parsed = parseMcpPayload(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
  assert.equal(parsed.result.ok, true);
});

test("parseMcpPayload parses Streamable HTTP SSE data frames", () => {
  const parsed = parseMcpPayload('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"workflow.start_project"}]}}\n\n');
  assert.equal(parsed.result.tools[0].name, "workflow.start_project");
});

test("allowed project roots are normalized and deduplicated", () => {
  const roots = normalizeAllowedProjectRoots(["C:\\work\\repo", "C:\\work\\repo", ""]);
  assert.equal(roots.length, 1);
});

test("runtime detects when the current workspace is missing from its allowlist", () => {
  assert.equal(hasMissingAllowedProjectRoots(["C:\\work\\one"], ["C:\\work\\one"]), false);
  assert.equal(hasMissingAllowedProjectRoots(["C:\\work\\one"], ["C:\\work\\two"]), true);
});


test("runtime server is staged outside the extension source directory", () => {
  const os = require("node:os");
  const runtimeHome = fs.mkdtempSync(path.join(os.tmpdir(), "constantx-runtime-"));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "constantx-source-"));
  const previousRuntimeHome = process.env.CONSTANTX_RUNTIME_HOME;
  process.env.CONSTANTX_RUNTIME_HOME = runtimeHome;
  fs.mkdirSync(path.join(source, "dist", "src"), { recursive: true });
  fs.writeFileSync(path.join(source, "dist", "src", "index.js"), "export {};", "utf8");
  const staged = stageRuntimeRoot(source);
  assert.equal(staged, runtimePaths().serverRoot);
  assert.notEqual(path.resolve(staged), path.resolve(source));
  assert.equal(fs.existsSync(path.join(staged, "dist", "src", "index.js")), true);
  fs.rmSync(source, { recursive: true, force: true });
  fs.rmSync(runtimeHome, { recursive: true, force: true });
  if (previousRuntimeHome === undefined) delete process.env.CONSTANTX_RUNTIME_HOME;
  else process.env.CONSTANTX_RUNTIME_HOME = previousRuntimeHome;
});
