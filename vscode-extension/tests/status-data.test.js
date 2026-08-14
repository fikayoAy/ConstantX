const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { analyzeCodexConfig, mergeCodexConfig, providerConfig, readJsonl, readStatusData, statusTone } = require("../src/status-data");

test("providerConfig creates Codex TOML config", () => {
  const config = providerConfig("codex", "http://127.0.0.1:4317/mcp");
  assert.equal(config.format, "toml");
  assert.equal(config.extension, "toml");
  assert.match(config.text, /\[mcp_servers\.ConstantX\]/);
  assert.doesNotMatch(config.text, /type =/);
  assert.match(config.text, /url = "http:\/\/127\.0\.0\.1:4317\/mcp"/);
  assert.match(config.text, /enabled = true/);
});

test("providerConfig creates Claude Code HTTP JSON config", () => {
  const config = providerConfig("claude", "http://127.0.0.1:4317/mcp");
  assert.equal(config.format, "json");
  assert.equal(config.extension, "json");
  assert.equal(config.data.mcpServers.ConstantX.type, "http");
  assert.equal(config.data.mcpServers.ConstantX.url, "http://127.0.0.1:4317/mcp");
});

test("providerConfig creates Streamable HTTP JSON config for generic providers", () => {
  const config = providerConfig("generic", "http://127.0.0.1:4317/mcp");
  assert.equal(config.format, "json");
  assert.equal(config.extension, "json");
  assert.equal(config.data.mcpServers.ConstantX.type, "streamable-http");
  assert.equal(config.data.mcpServers.ConstantX.url, "http://127.0.0.1:4317/mcp");
});

test("providerConfig creates stdio fallback config", () => {
  const config = providerConfig("stdio", "http://127.0.0.1:4317/mcp");
  assert.equal(config.format, "json");
  assert.equal(config.data.mcpServers.ConstantX.type, "stdio");
  assert.equal(config.data.mcpServers.ConstantX.command, "node");
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
test("analyzeCodexConfig detects duplicates and endpoint drift", () => {
  const text = [
    "[mcp_servers.ConstantX]",
    "url = \"http://127.0.0.1:4318/mcp\"",
    "enabled = true",
    "",
    "[mcp_servers.Other]",
    "url = \"http://127.0.0.1:9000/mcp\""
  ].join("\n");
  const analysis = analyzeCodexConfig(text, "http://127.0.0.1:4317/mcp");
  assert.equal(analysis.sectionCount, 1);
  assert.equal(analysis.duplicate, false);
  assert.equal(analysis.configuredUrl, "http://127.0.0.1:4318/mcp");
  assert.equal(analysis.urlMatches, false);
  assert.equal(analysis.hasEnabled, true);

  const duplicate = analyzeCodexConfig(`${text}\n\n[mcp_servers.ConstantX]\nurl = \"http://127.0.0.1:4317/mcp\"`, "http://127.0.0.1:4317/mcp");
  assert.equal(duplicate.duplicate, true);
});

test("mergeCodexConfig appends or replaces exactly one ConstantX section", () => {
  const endpoint = "http://127.0.0.1:4317/mcp";
  const appended = mergeCodexConfig("[other]\nvalue = true\n", endpoint);
  assert.match(appended, /\[other\]/);
  assert.match(appended, /\[mcp_servers\.ConstantX\]/);
  assert.match(appended, /url = "http:\/\/127\.0\.0\.1:4317\/mcp"/);

  const replaced = mergeCodexConfig('[mcp_servers.ConstantX]\nurl = "http://127.0.0.1:4318/mcp"\n\n[mcp_servers.Other]\nurl = "x"\n', endpoint);
  assert.doesNotMatch(replaced, /4318/);
  assert.match(replaced, /\[mcp_servers\.Other\]/);
  assert.equal(analyzeCodexConfig(replaced, endpoint).sectionCount, 1);

  assert.throws(() => mergeCodexConfig('[mcp_servers.ConstantX]\nurl = "a"\n\n[mcp_servers.ConstantX]\nurl = "b"\n', endpoint), /Duplicate/);
});