const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { providerConfig, readJsonl, readStatusData, statusTone } = require("../src/status-data");

test("providerConfig creates Streamable HTTP config for MCP providers", () => {
  const config = providerConfig("codex", "http://127.0.0.1:4317/mcp");
  assert.equal(config.mcpServers.ConstantX.type, "streamable-http");
  assert.equal(config.mcpServers.ConstantX.url, "http://127.0.0.1:4317/mcp");
});

test("providerConfig creates stdio fallback config", () => {
  const config = providerConfig("stdio", "http://127.0.0.1:4317/mcp");
  assert.equal(config.mcpServers.ConstantX.type, "stdio");
  assert.equal(config.mcpServers.ConstantX.command, "node");
});

test("readStatusData summarizes latest runs, jobs, logs, verification, and patch paths", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "constantx-status-"));
  const planner = path.join(project, ".planner");
  const runDir = path.join(planner, "persistent", "runs", "R-002");
  fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "patches"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "artifacts"), { recursive: true });
  fs.writeFileSync(path.join(planner, "runs.jsonl"), [
    JSON.stringify({ run_id: "R-001", job_id: "J-001", block_id: "B-001", status: "failed", started_at: "2026-01-01T00:00:00.000Z" }),
    JSON.stringify({ run_id: "R-002", job_id: "J-002", block_id: "B-002", status: "completed", started_at: "2026-01-02T00:00:00.000Z" })
  ].join("\n"));
  fs.writeFileSync(path.join(planner, "jobs.jsonl"), JSON.stringify({ run_id: "R-002", job_id: "J-002", status: "completed", started_at: "2026-01-02T00:00:00.000Z" }));
  fs.writeFileSync(path.join(runDir, "logs", "verify.log"), "ok");
  fs.writeFileSync(path.join(runDir, "patches", "final.patch"), "diff");
  fs.writeFileSync(path.join(runDir, "verification.md"), "passed");
  fs.writeFileSync(path.join(runDir, "artifacts", "manifest.json"), "{}\n");

  const data = readStatusData(project);
  assert.equal(data.latestRun.run_id, "R-002");
  assert.equal(data.latestJob.job_id, "J-002");
  assert.equal(data.paths.logs.length, 1);
  assert.match(data.paths.patch, /final\.patch$/);
  assert.match(data.paths.verification, /verification\.md$/);
});

test("readJsonl preserves malformed lines as parse errors", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "constantx-jsonl-")), "bad.jsonl");
  fs.writeFileSync(file, '{"ok":true}\nnot-json\n');
  const records = readJsonl(file);
  assert.equal(records[0].ok, true);
  assert.equal(records[1].parseError, true);
});

test("statusTone maps status values to visual tones", () => {
  assert.equal(statusTone("completed"), "success");
  assert.equal(statusTone("running"), "active");
  assert.equal(statusTone("waiting_for_agent"), "waiting");
  assert.equal(statusTone("failed"), "failed");
});