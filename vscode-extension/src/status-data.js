const fs = require("node:fs");
const path = require("node:path");

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { parseError: true, raw: line };
      }
    });
}

function latestByTimestamp(records, keys = ["finished_at", "updated_at", "started_at", "timestamp"]) {
  return [...records].sort((a, b) => timestampOf(b, keys) - timestampOf(a, keys));
}

function timestampOf(record, keys) {
  for (const key of keys) {
    if (record && record[key]) {
      const value = Date.parse(record[key]);
      if (!Number.isNaN(value)) return value;
    }
  }
  return 0;
}

function plannerRoot(projectPath) {
  return path.join(projectPath, ".planner");
}

function readStatusData(projectPath) {
  const root = plannerRoot(projectPath);
  const runs = latestByTimestamp(readJsonl(path.join(root, "runs.jsonl")));
  const jobs = latestByTimestamp(readJsonl(path.join(root, "jobs.jsonl")));
  const latestRun = runs[0];
  const latestJob = jobs.find((job) => latestRun && job.job_id === latestRun.job_id) || jobs[0];
  const persistentRunDir = latestRun?.run_id ? path.join(root, "persistent", "runs", latestRun.run_id) : undefined;
  const paths = persistentRunDir ? collectRunPaths(persistentRunDir) : { logs: [], patch: undefined, verification: undefined };
  return {
    projectPath,
    plannerRoot: root,
    runs: runs.slice(0, 20),
    jobs: jobs.slice(0, 20),
    latestRun,
    latestJob,
    paths
  };
}

function collectRunPaths(runDir) {
  const logsDir = path.join(runDir, "logs");
  const patch = path.join(runDir, "patches", "final.patch");
  const verification = path.join(runDir, "verification.md");
  const manifest = path.join(runDir, "artifacts", "manifest.json");
  const runJson = path.join(runDir, "run.json");
  const jobJson = path.join(runDir, "job.json");
  return {
    runDir,
    logs: fs.existsSync(logsDir) ? fs.readdirSync(logsDir).filter((name) => fs.statSync(path.join(logsDir, name)).isFile()).map((name) => path.join(logsDir, name)) : [],
    patch: fs.existsSync(patch) ? patch : undefined,
    verification: fs.existsSync(verification) ? verification : undefined,
    manifest: fs.existsSync(manifest) ? manifest : undefined,
    runJson: fs.existsSync(runJson) ? runJson : undefined,
    jobJson: fs.existsSync(jobJson) ? jobJson : undefined
  };
}

function providerConfig(provider, endpoint) {
  if (provider === "codex") {
    return {
      format: "toml",
      extension: "toml",
      text: [
        "[mcp_servers.ConstantX]",
        `url = \"${endpoint}\"`,
        "enabled = true",
        ""
      ].join("\n")
    };
  }

  const config = {
    mcpServers: {
      ConstantX: {
        type: provider === "claude" ? "http" : "streamable-http",
        url: endpoint
      }
    }
  };
  if (provider === "stdio") {
    config.mcpServers.ConstantX = {
      type: "stdio",
      command: "node",
      args: ["<ABSOLUTE_PATH_TO_CONSTANTX>/dist/src/index.js"]
    };
  }
  return {
    format: "json",
    extension: "json",
    text: `${JSON.stringify(config, null, 2)}\n`,
    data: config
  };
}
function analyzeCodexConfig(text, endpoint) {
  const source = String(text || "");
  const sectionPattern = /^\s*\[mcp_servers\.ConstantX\]\s*$/gm;
  const sections = [...source.matchAll(sectionPattern)];
  const sectionCount = sections.length;
  const configuredUrl = extractCodexConstantXUrl(source, sections[0]?.index);
  return {
    exists: source.length > 0,
    sectionCount,
    duplicate: sectionCount > 1,
    configuredUrl,
    urlMatches: configuredUrl === endpoint,
    hasEnabled: sectionCount > 0 && /enabled\s*=\s*true/.test(source.slice(sections[0].index, nextTomlSectionIndex(source, sections[0].index + 1)))
  };
}

function mergeCodexConfig(text, endpoint) {
  const source = String(text || "").trimEnd();
  const analysis = analyzeCodexConfig(source, endpoint);
  const block = ["[mcp_servers.ConstantX]", `url = "${endpoint}"`, "enabled = true"].join("\n");
  if (analysis.duplicate) {
    throw new Error("Duplicate [mcp_servers.ConstantX] sections found. Remove duplicates before updating automatically.");
  }
  if (analysis.sectionCount === 0) {
    return `${source}${source ? "\n\n" : ""}${block}\n`;
  }
  const start = source.search(/^\s*\[mcp_servers\.ConstantX\]\s*$/m);
  const end = nextTomlSectionIndex(source, start + 1);
  const before = source.slice(0, start).trimEnd();
  const after = source.slice(end).trimStart();
  return `${before}${before ? "\n\n" : ""}${block}${after ? `\n\n${after}` : ""}\n`;
}

function extractCodexConstantXUrl(source, sectionStart) {
  if (sectionStart === undefined) return undefined;
  const section = source.slice(sectionStart, nextTomlSectionIndex(source, sectionStart + 1));
  return section.match(/url\s*=\s*"([^"]+)"/)?.[1];
}

function nextTomlSectionIndex(source, start) {
  const rest = source.slice(start);
  const match = rest.match(/^\s*\[[^\]]+\]\s*$/m);
  return match && match.index !== undefined ? start + match.index : source.length;
}

function statusTone(status) {
  const value = String(status || "unknown").toLowerCase();
  if (["verified", "completed", "passed"].includes(value)) return "success";
  if (["running", "created", "prepared"].includes(value)) return "active";
  if (value.includes("waiting")) return "waiting";
  if (["failed", "error", "not_verified"].includes(value)) return "failed";
  return "neutral";
}

module.exports = {
  readJsonl,
  latestByTimestamp,
  readStatusData,
  providerConfig,
  statusTone,
  analyzeCodexConfig,
  mergeCodexConfig
};
