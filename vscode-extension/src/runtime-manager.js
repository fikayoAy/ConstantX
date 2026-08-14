const childProcess = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const SERVICE_NAME = "ConstantX";
const SERVICE_VERSION = "0.1.4";
const DEFAULT_TIMEOUT_MS = 1200;

function runtimeHome() {
  if (process.env.CONSTANTX_RUNTIME_HOME) return path.resolve(process.env.CONSTANTX_RUNTIME_HOME);
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".constantx"), "ConstantX");
}

function runtimePaths() {
  const root = runtimeHome();
  const logsDir = path.join(root, "logs");
  return {
    root,
    logsDir,
    serverRoot: path.join(root, "server", SERVICE_VERSION),
    metadataFile: path.join(root, "runtime.json"),
    latestLogFile: path.join(logsDir, "runtime-latest.log")
  };
}

function stageRuntimeRoot(sourceRoot) {
  const targetRoot = runtimePaths().serverRoot;
  const source = path.resolve(sourceRoot);
  const target = path.resolve(targetRoot);
  if (source === target) return target;

  const staging = `${target}.staging-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, staging, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(staging, target);
  return target;
}

class ConstantXRuntimeManager {
  constructor(options) {
    this.output = options.output;
    this.getSettings = options.getSettings;
    this.resolveRoot = options.resolveRoot;
    this.buildIfNeeded = options.buildIfNeeded;
    this.onStatus = options.onStatus || (() => undefined);
    this.restartFailures = 0;
    this.manualStop = false;
    this.supervisionTimer = undefined;
  }

  async ensureRuntime(reason = "manual") {
    this.manualStop = false;
    this.setStatus("Starting", reason);
    const settings = this.getSettings();
    const url = endpoint(settings);
    const health = await checkHealth(settings);
    if (health.ok && health.body?.service === SERVICE_NAME) {
      const metadata = readMetadata();
      const desiredRoots = normalizeAllowedProjectRoots(settings.allowedProjectRoots || []);
      const metadataMatchesHealth = metadata?.pid && Number(metadata.pid) === Number(health.body.pid);
      const healthRoots = normalizeAllowedProjectRoots(health.body.allowedProjectRoots || []);
      const existingRoots = metadataMatchesHealth
        ? normalizeAllowedProjectRoots(metadata.allowedProjectRoots || healthRoots)
        : healthRoots;
      const mergedRoots = normalizeAllowedProjectRoots([...existingRoots, ...desiredRoots]);

      if (hasMissingAllowedProjectRoots(existingRoots, desiredRoots)) {
        this.output?.appendLine?.(`Restarting ConstantX runtime to add project roots: ${desiredRoots.join(", ")}`);
        terminatePid(health.body.pid);
        removeMetadata();
        await waitForPortClosed(settings);
        return await this.launchRuntime({ ...settings, allowedProjectRoots: mergedRoots }, `${reason}-project-roots-changed`);
      }

      await this.writeMetadataFromHealth(health.body, { ...settings, allowedProjectRoots: existingRoots }, "adopted");
      const readiness = await checkMcpReadiness(url);
      if (!readiness.ok) throw new Error(`ConstantX runtime is reachable but MCP readiness failed: ${readiness.detail}`);
      this.restartFailures = 0;
      this.setStatus("Ready", `${url} (${readiness.tools.length} tools)`);
      return { status: "ready", adopted: true, health: health.body, readiness, metadata: readMetadata() };
    }

    if (await isPortOpen(settings.host, settings.port)) {
      this.setStatus("Conflict", `${settings.host}:${settings.port}`);
      throw new Error(`Port ${settings.port} is occupied by a process that is not a healthy ConstantX runtime. ConstantX will not terminate unrelated processes.`);
    }

    const metadata = readMetadata();
    if (metadata?.pid) {
      this.output?.appendLine?.(`Ignoring stale ConstantX runtime metadata for pid ${metadata.pid}.`);
    }
    return await this.launchRuntime(settings, reason);
  }

  async launchRuntime(settings, reason) {
    const sourceRoot = this.resolveRoot();
    const sourceEntry = path.join(sourceRoot, "dist", "src", "index.js");
    if (!fs.existsSync(sourceEntry)) {
      if (this.buildIfNeeded) await this.buildIfNeeded(sourceRoot);
      if (!fs.existsSync(sourceEntry)) throw new Error(`Missing bundled ConstantX MCP entrypoint: ${sourceEntry}`);
    }

    const root = stageRuntimeRoot(sourceRoot);
    const entry = path.join(root, "dist", "src", "index.js");
    const paths = runtimePaths();
    fs.mkdirSync(paths.logsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logFile = path.join(paths.logsDir, `runtime-${timestamp}.log`);
    const out = fs.openSync(logFile, "a");
    const err = fs.openSync(logFile, "a");
    const nodeCommand = settings.nodePath || process.execPath;
    const useElectronAsNode = !settings.nodePath;
    const child = childProcess.spawn(nodeCommand, [entry, "--http"], {
      cwd: root,
      detached: true,
      stdio: ["ignore", out, err],
      env: {
        ...process.env,
        CONSTANTX_MCP_MODE: "http",
        CONSTANTX_MCP_HOST: settings.host,
        CONSTANTX_MCP_PORT: String(settings.port),
        CONSTANTX_ALLOWED_PROJECT_ROOTS: (settings.allowedProjectRoots || []).join(path.delimiter),
        ...(useElectronAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {})
      },
      windowsHide: true,
      shell: process.platform === "win32" && !path.isAbsolute(nodeCommand)
    });
    child.unref();

    const metadata = {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      pid: child.pid,
      endpoint: endpoint(settings),
      healthUrl: healthEndpoint(settings),
      host: settings.host,
      port: settings.port,
      allowedProjectRoots: settings.allowedProjectRoots || [],
      root,
      entry,
      command: nodeCommand,
      args: [entry, "--http"],
      logFile,
      latestLogFile: logFile,
      startedAt: new Date().toISOString(),
      launchReason: reason,
      owner: SERVICE_NAME
    };
    writeMetadata(metadata);
    this.output?.appendLine?.(`Started ConstantX runtime pid ${child.pid}. Logs: ${logFile}`);

    const ready = await waitForReady(settings, 12000);
    if (!ready.ok) {
      this.setStatus("Crashed", logFile);
      throw new Error(`ConstantX runtime did not become ready: ${ready.detail}. Log: ${logFile}`);
    }
    await this.writeMetadataFromHealth(ready.health, settings, "started", logFile);
    this.restartFailures = 0;
    this.setStatus("Ready", endpoint(settings));
    return { status: "ready", adopted: false, health: ready.health, readiness: ready.readiness, metadata: readMetadata() };
  }

  async stopRuntime() {
    this.manualStop = true;
    const metadata = readMetadata();
    if (!metadata?.pid) {
      this.setStatus("Stopped", "No runtime metadata");
      return { stopped: false, reason: "No ConstantX runtime metadata was found." };
    }

    const settings = this.getSettings();
    const health = await checkHealth(settings);
    if (!health.ok || health.body?.service !== SERVICE_NAME || Number(health.body.pid) !== Number(metadata.pid)) {
      this.setStatus("Conflict", `Refused to stop pid ${metadata.pid}`);
      throw new Error(`Refusing to stop pid ${metadata.pid}; it is not verified as the ConstantX runtime for ${endpoint(settings)}.`);
    }

    terminatePid(metadata.pid);
    removeMetadata();
    this.setStatus("Stopped", `Stopped pid ${metadata.pid}`);
    return { stopped: true, pid: metadata.pid };
  }

  async checkRuntime() {
    const settings = this.getSettings();
    const health = await checkHealth(settings);
    if (!health.ok) {
      const conflict = await isPortOpen(settings.host, settings.port);
      const status = conflict ? "Conflict" : "Stopped";
      this.setStatus(status, health.detail);
      return { ok: false, status, health, readiness: { ok: false, detail: "MCP readiness not checked because /health failed.", tools: [] }, metadata: readMetadata() };
    }
    if (health.body?.service !== SERVICE_NAME) {
      this.setStatus("Conflict", `${settings.host}:${settings.port}`);
      return { ok: false, status: "Conflict", health, readiness: { ok: false, detail: "The health endpoint is not ConstantX.", tools: [] }, metadata: readMetadata() };
    }
    const readiness = await checkMcpReadiness(endpoint(settings));
    this.setStatus(readiness.ok ? "Ready" : "Crashed", readiness.ok ? `${readiness.tools.length} tools` : readiness.detail);
    return { ok: readiness.ok, status: readiness.ok ? "Ready" : "Crashed", health, readiness, metadata: readMetadata() };
  }

  startSupervision(intervalMs = 15000) {
    if (this.supervisionTimer) return;
    this.supervisionTimer = setInterval(async () => {
      if (this.manualStop) return;
      const settings = this.getSettings();
      const health = await checkHealth(settings);
      if (health.ok && health.body?.service === SERVICE_NAME) {
        this.restartFailures = 0;
        this.setStatus("Ready", endpoint(settings), true);
        return;
      }
      if (await isPortOpen(settings.host, settings.port)) {
        this.setStatus("Conflict", `${settings.host}:${settings.port}`);
        return;
      }
      if (this.restartFailures >= 3) {
        const paths = runtimePaths();
        this.setStatus("Crashed", `Restart limit reached. Logs: ${readMetadata()?.latestLogFile || paths.logsDir}`);
        return;
      }
      this.restartFailures += 1;
      const delay = Math.min(1000 * (2 ** this.restartFailures), 8000);
      this.setStatus("Starting", `Restart ${this.restartFailures} in ${delay}ms`);
      setTimeout(() => this.ensureRuntime("supervision-restart").catch((error) => {
        this.output?.appendLine?.(`ConstantX supervision restart failed: ${error.message}`);
      }), delay);
    }, intervalMs);
  }

  dispose() {
    if (this.supervisionTimer) clearInterval(this.supervisionTimer);
    this.supervisionTimer = undefined;
  }

  async writeMetadataFromHealth(health, settings, status, logFile) {
    const current = readMetadata() || {};
    writeMetadata({
      ...current,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      pid: health.pid,
      endpoint: endpoint(settings),
      healthUrl: healthEndpoint(settings),
      host: settings.host,
      port: settings.port,
      status,
      logFile: logFile || current.logFile,
      latestLogFile: logFile || current.latestLogFile,
      adoptedAt: status === "adopted" ? new Date().toISOString() : current.adoptedAt,
      checkedAt: new Date().toISOString(),
      owner: SERVICE_NAME
    });
  }

  setStatus(status, detail, quiet = false) {
    if (!quiet) this.output?.appendLine?.(`Runtime status: ${status}${detail ? ` - ${detail}` : ""}`);
    this.onStatus(status, detail);
  }
}

function endpoint(settings) {
  return `http://${settings.host}:${settings.port}/mcp`;
}

function healthEndpoint(settings) {
  return `http://${settings.host}:${settings.port}/health`;
}

async function waitForReady(settings, timeoutMs) {
  const started = Date.now();
  let detail = "Runtime did not answer before timeout.";
  while (Date.now() - started < timeoutMs) {
    const health = await checkHealth(settings);
    if (health.ok && health.body?.service === SERVICE_NAME) {
      const readiness = await checkMcpReadiness(endpoint(settings));
      if (readiness.ok) return { ok: true, health: health.body, readiness };
      detail = readiness.detail;
    } else {
      detail = health.detail;
    }
    await sleep(300);
  }
  return { ok: false, detail };
}

async function checkHealth(settings) {
  try {
    const response = await fetchWithTimeout(healthEndpoint(settings), { method: "GET" }, DEFAULT_TIMEOUT_MS);
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    return { ok: response.ok, status: response.status, body, detail: response.ok ? "OK" : text };
  } catch (error) {
    return { ok: false, detail: error.message };
  }
}

async function checkMcpReadiness(url) {
  const initialize = await mcpRequest(url, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "constantx-vscode", version: SERVICE_VERSION }
  }, 1);
  if (!initialize.ok) return { ok: false, detail: `initialize failed: ${initialize.detail}`, tools: [] };

  const tools = await mcpRequest(url, "tools/list", {}, 2);
  if (!tools.ok) return { ok: false, detail: `tools/list failed: ${tools.detail}`, tools: [] };
  const toolList = Array.isArray(tools.body?.result?.tools) ? tools.body.result.tools : [];
  return { ok: true, detail: `${toolList.length} tools`, tools: toolList.map((tool) => tool.name).filter(Boolean) };
}

async function mcpRequest(url, method, params, id) {
  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json, text/event-stream"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
    }, 5000);
    const text = await response.text();
    const body = parseMcpPayload(text);
    if (!response.ok || body?.error) return { ok: false, status: response.status, body, detail: body?.error?.message || text };
    return { ok: true, status: response.status, body, detail: "OK" };
  } catch (error) {
    return { ok: false, detail: error.message };
  }
}

function parseMcpPayload(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("event:") || trimmed.startsWith("data:")) {
    const data = trimmed.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n")
      .trim();
    return data ? JSON.parse(data) : {};
  }
  return JSON.parse(trimmed);
}

function normalizeAllowedProjectRoots(roots) {
  const normalized = roots
    .filter((root) => typeof root === "string" && root.trim())
    .map((root) => path.resolve(root.trim()));
  return [...new Set(normalized.map((root) => process.platform === "win32" ? root.toLowerCase() : root))];
}

function hasMissingAllowedProjectRoots(existingRoots, desiredRoots) {
  const existing = new Set(normalizeAllowedProjectRoots(existingRoots));
  return normalizeAllowedProjectRoots(desiredRoots).some((root) => !existing.has(root));
}

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function waitForPortClosed(settings, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortOpen(settings.host, settings.port))) return;
    await sleep(100);
  }
  throw new Error(`ConstantX runtime did not release port ${settings.port} after shutdown.`);
}

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(800);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function terminatePid(pid) {
  if (process.platform === "win32") {
    childProcess.spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // The process may have exited between health verification and termination.
  }
}

function readMetadata() {
  const file = runtimePaths().metadataFile;
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function writeMetadata(metadata) {
  const paths = runtimePaths();
  fs.mkdirSync(paths.root, { recursive: true });
  fs.writeFileSync(paths.metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function removeMetadata() {
  fs.rmSync(runtimePaths().metadataFile, { force: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  ConstantXRuntimeManager,
  SERVICE_NAME,
  SERVICE_VERSION,
  runtimeHome,
  runtimePaths,
  stageRuntimeRoot,
  endpoint,
  healthEndpoint,
  checkHealth,
  checkMcpReadiness,
  parseMcpPayload,
  normalizeAllowedProjectRoots,
  hasMissingAllowedProjectRoots,
  readMetadata,
  writeMetadata,
  removeMetadata,
  isPortOpen
};