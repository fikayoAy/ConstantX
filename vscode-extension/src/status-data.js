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
  const config = {
    mcpServers: {
      ConstantX: {
        type: "streamable-http",
        url: endpoint
      }
    }
  };
  if (provider === "stdio") {
    return {
      mcpServers: {
        ConstantX: {
          type: "stdio",
          command: "node",
          args: ["<ABSOLUTE_PATH_TO_CONSTANTX>/dist/src/index.js"]
        }
      }
    };
  }
  return config;
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
  statusTone
};
