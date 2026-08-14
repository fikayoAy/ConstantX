const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");
const { providerConfig, readStatusData, statusTone, analyzeCodexConfig, mergeCodexConfig } = require("./status-data");
const { ConstantXRuntimeManager, runtimePaths, readMetadata } = require("./runtime-manager");

let runtimeManager;
let outputChannel;
let statusPanel;
let statusBarItem;

function activate(context) {
  outputChannel = vscode.window.createOutputChannel("ConstantX");
  context.subscriptions.push(outputChannel);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "constantx.healthCheck";
  context.subscriptions.push(statusBarItem);
  updateRuntimeStatus("Stopped", "not checked");

  runtimeManager = new ConstantXRuntimeManager({
    output: outputChannel,
    getSettings: runtimeSettings,
    resolveRoot: () => constantxRoot(context),
    buildIfNeeded: async (root) => {
      const bundledRoot = path.join(context.extensionPath, "server");
      if (path.resolve(root) === path.resolve(bundledRoot)) {
        throw new Error(`Bundled ConstantX server is missing dist/src/index.js inside ${bundledRoot}. Reinstall the extension.`);
      }
      await runBuild(root);
    },
    onStatus: updateRuntimeStatus
  });
  context.subscriptions.push({ dispose: () => runtimeManager.dispose() });

  registerConstantXCommand(context, "constantx.startRuntime", () => startRuntime(context));
  registerConstantXCommand(context, "constantx.stopRuntime", stopRuntime);
  registerConstantXCommand(context, "constantx.checkRuntime", checkRuntime);
  registerConstantXCommand(context, "constantx.connectProvider", () => connectProvider(context));
  registerConstantXCommand(context, "constantx.openWorkflowPrompts", () => openWorkflowPrompts(context));
  registerConstantXCommand(context, "constantx.openStatusPanel", () => openStatusPanel(context));
  registerConstantXCommand(context, "constantx.openRuntimeLogs", openRuntimeLogs);
  registerConstantXCommand(context, "constantx.firstRunSetup", () => firstRunSetup(context));
  registerConstantXCommand(context, "constantx.healthCheck", () => healthCheck(context));

  if (runtimeSettings().autoStart) {
    runtimeManager.ensureRuntime("auto-start").then(() => {
      runtimeManager.startSupervision();
    }).catch((error) => {
      updateRuntimeStatus("Crashed", error.message);
      outputChannel.appendLine(`ConstantX auto-start failed: ${error.stack || error.message}`);
    });
  }
}

function registerConstantXCommand(context, command, handler) {
  context.subscriptions.push(vscode.commands.registerCommand(command, async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      const detail = error && error.stack ? error.stack : String(error && error.message ? error.message : error);
      outputChannel.appendLine(`Command ${command} failed:`);
      outputChannel.appendLine(detail);
      outputChannel.show(true);
      vscode.window.showErrorMessage(`ConstantX command failed: ${error && error.message ? error.message : String(error)}. See the ConstantX output channel.`);
      return undefined;
    }
  }));
}

function deactivate() {
  if (runtimeManager) runtimeManager.dispose();
}

async function startRuntime(context) {
  const result = await runtimeManager.ensureRuntime("manual-start");
  runtimeManager.startSupervision();
  vscode.window.showInformationMessage(`ConstantX runtime ready at ${endpoint()} (${result.readiness.tools.length} tools).`);
}

async function stopRuntime() {
  const result = await runtimeManager.stopRuntime();
  vscode.window.showInformationMessage(result.stopped ? `ConstantX runtime stopped (pid ${result.pid}).` : result.reason);
}

async function checkRuntime() {
  const result = await runtimeManager.checkRuntime();
  const toolText = result.readiness.tools.length ? `${result.readiness.tools.length} tools` : result.readiness.detail;
  if (result.ok) {
    vscode.window.showInformationMessage(`ConstantX runtime ready at ${endpoint()} (${toolText}).`);
  } else {
    vscode.window.showWarningMessage(`ConstantX runtime ${result.status}: ${result.health.detail || result.readiness.detail}`);
  }
}

async function connectProvider(context) {
  await runtimeManager.ensureRuntime("connect-provider");
  runtimeManager.startSupervision();
  const provider = await vscode.window.showQuickPick([
    { label: "Codex", value: "codex" },
    { label: "Claude Code", value: "claude" },
    { label: "Generic MCP", value: "generic" },
    { label: "Stdio Fallback", value: "stdio" }
  ], { placeHolder: "Choose the provider config to generate" });
  if (!provider) return;

  const written = await writeProviderConfigFiles(context, provider.value);
  await vscode.env.clipboard.writeText(written.configText);
  const doc = await vscode.workspace.openTextDocument(written.notesFile);
  await vscode.window.showTextDocument(doc);
  if (provider.value === "codex") await offerCodexConfigUpdate(endpoint());
  vscode.window.showInformationMessage(`${provider.label} MCP config and install notes written. Config copied to clipboard. Restart the provider or open a new session after changing MCP settings.`);
}

async function firstRunSetup(context) {
  outputChannel.show(true);
  outputChannel.appendLine("Starting ConstantX first-run setup...");
  await runtimeManager.ensureRuntime("first-run-setup");
  runtimeManager.startSupervision();
  const providers = ["codex", "claude", "generic", "stdio"];
  const written = [];
  for (const provider of providers) {
    written.push(await writeProviderConfigFiles(context, provider));
  }
  await offerCodexConfigUpdate(endpoint());
  await healthCheck(context);
  await openWorkflowPrompts(context);
  openStatusPanel(context);
  vscode.window.showInformationMessage(`ConstantX setup complete. Provider configs written: ${written.map((item) => path.basename(item.configFile)).join(", ")}. Restart Codex or open a new Codex session after MCP config changes.`);
}

function updateRuntimeStatus(status, detail = "") {
  if (!statusBarItem) return;
  const icon = status === "Ready" ? "$(check)" : status === "Starting" ? "$(sync~spin)" : status === "Conflict" ? "$(warning)" : status === "Crashed" ? "$(error)" : "$(circle-slash)";
  statusBarItem.text = `${icon} ConstantX: ${status}`;
  statusBarItem.tooltip = detail ? `ConstantX ${status}: ${detail}` : `ConstantX ${status}`;
  statusBarItem.backgroundColor = status === "Conflict" || status === "Crashed" ? new vscode.ThemeColor("statusBarItem.errorBackground") : undefined;
  statusBarItem.show();
}

async function openRuntimeLogs() {
  const metadata = readMetadata();
  const paths = runtimePaths();
  const candidates = [metadata?.logFile, metadata?.latestLogFile, paths.latestLogFile].filter(Boolean);
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) {
    vscode.window.showWarningMessage(`No ConstantX runtime log file found yet. Expected logs under ${paths.logsDir}.`);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function offerCodexConfigUpdate(url) {
  const file = codexConfigPath();
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const analysis = analyzeCodexConfig(current, url);
  if (analysis.duplicate) {
    vscode.window.showErrorMessage(`Codex config has ${analysis.sectionCount} [mcp_servers.ConstantX] sections. Remove duplicates in ${file} before ConstantX can update it safely.`);
    return { updated: false, reason: "duplicate" };
  }
  if (analysis.sectionCount === 1 && analysis.urlMatches && analysis.hasEnabled) {
    return { updated: false, reason: "already-configured" };
  }
  const action = analysis.sectionCount === 0 ? "Create Codex Config" : "Update Codex Config";
  const choice = await vscode.window.showWarningMessage(`ConstantX can ${analysis.sectionCount === 0 ? "add" : "update"} the Codex MCP config at ${file}. A backup is created first when the file already exists.`, action, "Skip");
  if (choice !== action) return { updated: false, reason: "skipped" };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const backup = `${file}.constantx-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(file, backup);
    outputChannel.appendLine(`Backed up Codex config to ${backup}`);
  }
  const updated = mergeCodexConfig(current, url);
  fs.writeFileSync(file, updated, "utf8");
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc, { preview: false });
  vscode.window.showInformationMessage("Codex MCP config updated for ConstantX. Restart Codex or open a new Codex session before testing tools.");
  return { updated: true };
}

function codexConfigPath() {
  return path.join(process.env.USERPROFILE || process.env.HOME || "", ".codex", "config.toml");
}

function codexConfigCheckLines(url) {
  const file = codexConfigPath();
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const analysis = analyzeCodexConfig(current, url);
  return [
    checkLine("Codex config", file, fs.existsSync(file), fs.existsSync(file) ? "Found config.toml." : "No Codex config.toml found yet."),
    checkLine("Codex ConstantX section", "[mcp_servers.ConstantX]", analysis.sectionCount === 1, analysis.duplicate ? `${analysis.sectionCount} duplicate sections found.` : `${analysis.sectionCount} section(s) found.`),
    checkLine("Codex endpoint", url, analysis.urlMatches, analysis.configuredUrl ? `Configured URL: ${analysis.configuredUrl}` : "No ConstantX URL configured."),
    checkLine("Codex enabled flag", "enabled = true", analysis.hasEnabled, analysis.hasEnabled ? "Enabled." : "Missing enabled flag.")
  ];
}
async function healthCheck(context) {
  const root = constantxRoot(context);
  const projectPath = configuredProjectPath() || workspaceFolderPath() || root;
  const config = runtimeSettings();
  const checks = [];
  checks.push(checkLine("Node runtime", config.nodePath || process.execPath, true, config.nodePath ? "Configured external Node executable used for the MCP runtime." : "Using VS Code/Electron as Node via ELECTRON_RUN_AS_NODE."));
  checks.push(checkLine("ConstantX root", root, fs.existsSync(root)));
  checks.push(checkLine("MCP entrypoint", path.join(root, "dist", "src", "index.js"), fs.existsSync(path.join(root, "dist", "src", "index.js"))));
  checks.push(checkLine("Project path", projectPath, fs.existsSync(projectPath)));
  checks.push(checkLine("Planner state", path.join(projectPath, ".planner"), fs.existsSync(path.join(projectPath, ".planner"))));
  checks.push(checkLine("Project config", "deep-research.config.json or constantx.config.json", Boolean(findProjectConfig(projectPath))));
  const runtime = await runtimeManager.checkRuntime();
  checks.push(checkLine("HTTP health endpoint", `http://${config.host}:${config.port}/health`, runtime.health.ok, runtime.health.ok ? `PID ${runtime.health.body.pid}, status ${runtime.health.body.status}` : runtime.health.detail));
  checks.push(checkLine("MCP readiness", endpoint(), runtime.readiness.ok, runtime.readiness.ok ? `${runtime.readiness.tools.length} tools: ${runtime.readiness.tools.slice(0, 8).join(", ")}` : runtime.readiness.detail));
  const metadata = readMetadata();
  checks.push(checkLine("Runtime metadata", runtimePaths().metadataFile, Boolean(metadata), metadata ? `PID ${metadata.pid}, log ${metadata.logFile || metadata.latestLogFile || "not recorded"}` : "No runtime metadata found."));
  checks.push(...codexConfigCheckLines(endpoint()));
  const wsl = await runCommand("wsl.exe", ["--list", "--verbose"], root);
  checks.push(checkLine("WSL distros", "wsl.exe --list --verbose", wsl.code === 0, wsl.code === 0 ? wsl.output : "WSL unavailable or not configured"));

  const report = [
    "# ConstantX Health Check",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Runtime endpoint: http://${config.host}:${config.port}/mcp`,
    `Project path: ${projectPath}`,
    "",
    "## Checks",
    "",
    ...checks,
    "",
    "## Next Steps",
    "",
    "- If the MCP entrypoint is missing, run `npm run build` in the ConstantX repo.",
    "- If HTTP runtime is unreachable, run `ConstantX: Start Runtime` and open `ConstantX: Open Runtime Logs`.",
    "- If no WSL2 distro is available, configure WSL2 or explicitly approve local-project fallback per run.",
    "- Restart Codex or open a new Codex session after MCP config changes."
  ].join("\n");
  const outDir = path.join(workspaceFolderPath() || root, ".constantx");
  fs.mkdirSync(outDir, { recursive: true });
  const reportFile = path.join(outDir, "health-check.md");
  fs.writeFileSync(reportFile, `${report}\n`, "utf8");
  const doc = await vscode.workspace.openTextDocument(reportFile);
  await vscode.window.showTextDocument(doc);
  return { reportFile, checks };
}

async function writeProviderConfigFiles(context, provider) {
  const config = providerConfig(provider, endpoint());
  const configText = config.text;
  const folder = workspaceFolderPath() || constantxRoot(context);
  const outDir = path.join(folder, ".constantx", "provider-configs");
  fs.mkdirSync(outDir, { recursive: true });
  const configFile = path.join(outDir, `${provider}-mcp.${config.extension}`);
  const notesFile = path.join(outDir, `${provider}-install.md`);
  fs.writeFileSync(configFile, `${configText}\n`, "utf8");
  fs.writeFileSync(notesFile, providerInstallNotes(provider, configFile, configText, config.format), "utf8");
  return { configFile, notesFile, configText };
}

function providerInstallNotes(provider, configFile, configText, language = "json") {
  const target = provider === "codex"
    ? "%USERPROFILE%\\.codex\\config.toml"
    : provider === "claude"
      ? "Claude Code: use `claude mcp add --transport http ConstantX http://127.0.0.1:4317/mcp` or merge this JSON into `.mcp.json` / `~/.claude.json`"
      : provider === "stdio"
        ? "Any MCP client that supports stdio servers"
        : "Any MCP client that supports Streamable HTTP / `streamable-http` JSON";
  return [
    `# ConstantX ${provider} MCP Setup`,
    "",
    `Generated config file: ${configFile}`,
    `Suggested target: ${target}`,
    "",
    "ConstantX does not silently overwrite provider config files. Review your provider's current MCP settings and merge this config manually.",
    "",
    "```" + language,
    configText,
    "```",
    "",
    provider === "claude" ? "For Claude Desktop remote connectors, localhost is not enough because cloud-hosted Claude must reach the MCP URL. Use Claude Code for this local VS Code runtime, or expose a secure public endpoint." : "After updating provider settings, restart the provider or open a new session, then run `ConstantX: Check Runtime` in VS Code."
  ].join("\n");
}

function checkLine(name, target, ok, detail = "") {
  return `- ${ok ? "[x]" : "[ ]"} ${name}: ${target}${detail ? `\n  ${detail.replace(/\r?\n/g, "\n  ")}` : ""}`;
}

async function checkEndpointReachable(url) {
  try {
    const response = await fetch(url, { method: "GET" });
    return { ok: true, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: error.message };
  }
}

function findProjectConfig(projectPath) {
  return ["deep-research.config.json", "constantx.config.json"].map((name) => path.join(projectPath, name)).find((file) => fs.existsSync(file));
}
async function openWorkflowPrompts(context) {
  const candidates = [
    path.join(process.env.USERPROFILE || "", ".codex", "ConstantX_workflow.md"),
    path.join(constantxRoot(context), "docs", "workflow-commands.md")
  ];
  const file = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!file) {
    vscode.window.showErrorMessage("No ConstantX workflow prompt document was found.");
    return;
  }
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
}

function openStatusPanel(context) {
  const projectPath = configuredProjectPath() || workspaceFolderPath() || constantxRoot(context);
  const data = readStatusData(projectPath);
  if (!statusPanel) {
    statusPanel = vscode.window.createWebviewPanel("constantxStatus", "ConstantX Status", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true
    });
    statusPanel.onDidDispose(() => { statusPanel = undefined; });
    statusPanel.webview.onDidReceiveMessage(async (message) => handleStatusMessage(message, context));
  }
  statusPanel.webview.html = renderStatusPanel(data, statusPanel.webview.cspSource);
  statusPanel.reveal();
}

async function handleStatusMessage(message, context) {
  if (!message || !message.command) return;
  if (message.command === "refresh") {
    openStatusPanel(context);
    return;
  }
  if (message.command === "copy" && message.value) {
    await vscode.env.clipboard.writeText(message.value);
    vscode.window.showInformationMessage("Copied to clipboard.");
    return;
  }
  if (message.command === "open" && message.path && fs.existsSync(message.path)) {
    const doc = await vscode.workspace.openTextDocument(message.path);
    await vscode.window.showTextDocument(doc);
    return;
  }
  if (message.command === "inspectRun") {
    await inspectRunFiles(message);
    return;
  }
  if (message.command === "applyPatch") {
    await applyPatchFromPanel(message, context);
    return;
  }
  if (message.command === "rerunVerification") {
    await rerunVerificationFromPanel(message, context);
  }
}

function renderStatusPanel(data, cspSource) {
  const latestRun = data.latestRun || {};
  const latestJob = data.latestJob || {};
  const tone = statusTone(latestRun.status || latestJob.status);
  const logs = data.paths.logs || [];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ConstantX Status</title>
<style>
:root { --bg:#07130f; --panel:#0d1d18; --panel2:#121229; --green:#21d07a; --green2:#8df7bd; --purple:#a78bfa; --purple2:#6d5dfc; --amber:#f7c948; --red:#ff6b6b; --text:#ecfff6; --muted:#9fb8ad; --line:rgba(141,247,189,.22); }
* { box-sizing: border-box; }
body { margin:0; background: radial-gradient(circle at 15% 10%, rgba(33,208,122,.18), transparent 26%), radial-gradient(circle at 82% 0%, rgba(167,139,250,.22), transparent 28%), linear-gradient(135deg, #050907, #111026 58%, #07130f); color:var(--text); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.shell { padding:28px; min-height:100vh; }
.hero { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:22px; border:1px solid var(--line); border-radius:24px; background:linear-gradient(135deg, rgba(13,29,24,.92), rgba(18,18,41,.92)); box-shadow:0 24px 80px rgba(0,0,0,.35); }
.brand { display:flex; flex-direction:column; gap:8px; }
.kicker { color:var(--green2); letter-spacing:.18em; font-size:11px; text-transform:uppercase; }
h1 { margin:0; font-size:34px; line-height:1; }
.endpoint { color:var(--muted); }
.badge { border:1px solid currentColor; border-radius:999px; padding:8px 13px; font-weight:700; text-transform:uppercase; font-size:12px; }
.success { color:var(--green); } .active { color:var(--purple); } .waiting { color:var(--amber); } .failed { color:var(--red); } .neutral { color:var(--muted); }
.grid { display:grid; grid-template-columns: 1.05fr 1.55fr .95fr; gap:18px; margin-top:18px; }
.card { border:1px solid var(--line); border-radius:20px; background:rgba(8,20,16,.78); padding:18px; min-height:160px; }
.card.purple { background:rgba(18,18,41,.78); border-color:rgba(167,139,250,.28); }
.card h2 { margin:0 0 14px; font-size:14px; color:var(--green2); text-transform:uppercase; letter-spacing:.14em; }
.item { border:1px solid rgba(255,255,255,.08); border-radius:14px; padding:12px; margin:10px 0; background:rgba(255,255,255,.035); }
.row { display:flex; justify-content:space-between; gap:14px; align-items:center; }
.label { color:var(--muted); font-size:12px; }
.value { color:var(--text); word-break:break-all; }
.timeline { display:flex; flex-direction:column; gap:10px; }
.run { border-left:3px solid var(--purple); padding:10px 12px; background:rgba(167,139,250,.08); border-radius:0 14px 14px 0; }
.run.success { border-left-color:var(--green); } .run.failed { border-left-color:var(--red); } .run.waiting { border-left-color:var(--amber); }
.actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:14px; }
button { cursor:pointer; border:1px solid rgba(141,247,189,.35); background:linear-gradient(135deg, rgba(33,208,122,.18), rgba(167,139,250,.16)); color:var(--text); border-radius:12px; padding:9px 11px; font-family:inherit; }
button:hover { border-color:var(--green2); transform:translateY(-1px); }
.empty { color:var(--muted); font-style:italic; }
.path { font-size:12px; color:var(--muted); word-break:break-all; }
@media (max-width: 980px) { .grid { grid-template-columns: 1fr; } .hero { flex-direction:column; align-items:flex-start; } }
</style>
</head>
<body>
<div class="shell">
  <section class="hero">
    <div class="brand">
      <div class="kicker">ConstantX Runtime</div>
      <h1>Runs, Jobs, Logs, Patches</h1>
      <div class="endpoint">${escapeHtml(data.projectPath)}</div>
    </div>
    <div class="badge ${tone}">${escapeHtml(latestRun.status || latestJob.status || "no runs")}</div>
  </section>
  <div class="actions">
    <button onclick="post('refresh')">Refresh</button>
    ${latestRun.run_id ? `<button onclick="copy('${escapeAttr(latestRun.run_id)}')">Copy Run ID</button><button onclick="post('inspectRun', { runId: '${escapeAttr(latestRun.run_id)}', runJson: '${escapeAttr(data.paths.runJson || '')}', jobJson: '${escapeAttr(data.paths.jobJson || '')}' })">Inspect Failed Job</button><button onclick="post('rerunVerification', { runId: '${escapeAttr(latestRun.run_id)}', projectPath: '${escapeAttr(data.projectPath)}' })">Rerun Verification</button>` : ""}
    ${data.paths.patch ? `<button onclick="openPath('${escapeAttr(data.paths.patch)}')">Open Patch</button><button onclick="copy('${escapeAttr(data.paths.patch)}')">Copy Patch Path</button><button onclick="post('applyPatch', { runId: '${escapeAttr(latestRun.run_id || '')}', projectPath: '${escapeAttr(data.projectPath)}', patch: '${escapeAttr(data.paths.patch)}' })">Apply Patch</button>` : ""}
    ${data.paths.verification ? `<button onclick="openPath('${escapeAttr(data.paths.verification)}')">Open Verification</button>` : ""}
  </div>
  <main class="grid">
    <section class="card">
      <h2>Latest Run</h2>
      ${renderKeyValue("Run", latestRun.run_id)}
      ${renderKeyValue("Block", latestRun.block_id)}
      ${renderKeyValue("Runtime", latestRun.runtime)}
      ${renderKeyValue("Status", latestRun.status)}
      ${renderKeyValue("Started", latestRun.started_at)}
      ${renderKeyValue("Finished", latestRun.finished_at)}
    </section>
    <section class="card purple">
      <h2>Timeline</h2>
      <div class="timeline">${data.runs.length ? data.runs.slice(0, 8).map(renderRun).join("") : '<div class="empty">No runtime runs recorded yet.</div>'}</div>
    </section>
    <section class="card">
      <h2>Artifacts</h2>
      ${renderPathAction("Patch", data.paths.patch)}
      ${renderPathAction("Verification", data.paths.verification)}
      ${renderPathAction("Manifest", data.paths.manifest)}
      <div class="item"><div class="label">Logs</div>${logs.length ? logs.map((log) => `<div class="path">${escapeHtml(log)}</div><button onclick="openPath('${escapeAttr(log)}')">Open</button>`).join("") : '<div class="empty">No logs found.</div>'}</div>
    </section>
  </main>
</div>
<script>
const vscode = acquireVsCodeApi();
function post(command, value) { vscode.postMessage({ command, ...(value || {}) }); }
function copy(value) { vscode.postMessage({ command: 'copy', value }); }
function openPath(path) { vscode.postMessage({ command: 'open', path }); }
</script>
</body>
</html>`;
}

function renderRun(run) {
  const tone = statusTone(run.status);
  return `<div class="run ${tone}"><div class="row"><strong>${escapeHtml(run.run_id || "unknown")}</strong><span class="badge ${tone}">${escapeHtml(run.status || "unknown")}</span></div><div class="label">${escapeHtml(run.block_id || "no block")} � ${escapeHtml(run.runtime || "runtime")}</div><div class="path">${escapeHtml(run.failure_reason || run.patch_path || "")}</div></div>`;
}

function renderKeyValue(label, value) {
  return `<div class="item"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value || "Not recorded")}</div></div>`;
}

function renderPathAction(label, value) {
  if (!value) return `<div class="item"><div class="label">${escapeHtml(label)}</div><div class="empty">Not available</div></div>`;
  return `<div class="item"><div class="label">${escapeHtml(label)}</div><div class="path">${escapeHtml(value)}</div><button onclick="openPath('${escapeAttr(value)}')">Open</button><button onclick="copy('${escapeAttr(value)}')">Copy</button></div>`;
}

async function inspectRunFiles(message) {
  const opened = [];
  for (const file of [message.runJson, message.jobJson].filter(Boolean)) {
    if (fs.existsSync(file)) {
      const doc = await vscode.workspace.openTextDocument(file);
      await vscode.window.showTextDocument(doc, { preview: false });
      opened.push(path.basename(file));
    }
  }
  vscode.window.showInformationMessage(opened.length ? `Opened ${opened.join(" and ")} for ${message.runId}.` : `No run/job files found for ${message.runId}.`);
}

async function applyPatchFromPanel(message, context) {
  if (!message.patch || !message.projectPath || !fs.existsSync(message.patch)) {
    vscode.window.showErrorMessage("No patch file is available for this run.");
    return;
  }
  const choice = await vscode.window.showWarningMessage(`Apply ConstantX patch ${message.runId || ""} to the real project? Review final.patch first.`, { modal: true }, "Apply Patch");
  if (choice !== "Apply Patch") return;
  const check = await runCommand("git", ["apply", "--check", message.patch], message.projectPath);
  if (check.code !== 0) {
    outputChannel.appendLine(check.output);
    vscode.window.showErrorMessage("Patch check failed. Open the ConstantX output channel for details.");
    return;
  }
  const apply = await runCommand("git", ["apply", message.patch], message.projectPath);
  outputChannel.appendLine(apply.output);
  appendRuntimeControlEvent(message.projectPath, { action: "vscode-apply-patch", run_id: message.runId, status: apply.code === 0 ? "applied" : "failed", patch_path: message.patch });
  if (apply.code === 0) {
    vscode.window.showInformationMessage("ConstantX patch applied to the real project.");
    openStatusPanel(context);
  } else {
    vscode.window.showErrorMessage("Patch apply failed. Open the ConstantX output channel for details.");
  }
}

async function rerunVerificationFromPanel(message, context) {
  const projectPath = message.projectPath || configuredProjectPath() || workspaceFolderPath();
  if (!projectPath) {
    vscode.window.showErrorMessage("No project path is selected for verification rerun.");
    return;
  }
  const config = readConstantXConfig(projectPath);
  const commands = config.verification?.commands || [];
  if (!commands.length) {
    vscode.window.showErrorMessage("No verification.commands are configured for this project.");
    return;
  }
  const choice = await vscode.window.showWarningMessage(`Rerun ${commands.length} verification command(s) in the real project workspace?`, { modal: true }, "Rerun Verification");
  if (choice !== "Rerun Verification") return;
  const results = [];
  for (const command of commands) {
    const result = await runCommand(command, [], projectPath, true);
    results.push({ command, code: result.code });
    outputChannel.appendLine(result.output);
    if (result.code !== 0) break;
  }
  appendRuntimeControlEvent(projectPath, { action: "vscode-rerun-verification", run_id: message.runId, status: results.every((result) => result.code === 0) ? "passed" : "failed", commands_run: results });
  vscode.window.showInformationMessage(results.every((result) => result.code === 0) ? "Verification rerun passed." : "Verification rerun failed. Open the ConstantX output channel for details.");
  openStatusPanel(context);
}

function readConstantXConfig(projectPath) {
  for (const name of ["deep-research.config.json", "constantx.config.json"]) {
    const file = path.join(projectPath, name);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return {};
}

function appendRuntimeControlEvent(projectPath, event) {
  const planner = path.join(projectPath, ".planner");
  fs.mkdirSync(planner, { recursive: true });
  fs.appendFileSync(path.join(planner, "runtime-controls.jsonl"), `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`, "utf8");
}

function runCommand(command, args, cwd, shell = false) {
  return new Promise((resolve) => {
    let child;
    const display = shell ? command : [command, ...args].join(" ");
    let output = `$ ${display}\n`;
    try {
      child = childProcess.spawn(command, args, { cwd, shell, windowsHide: true });
    } catch (error) {
      resolve({ code: 1, output: `${output}${error.message}` });
      return;
    }
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", (error) => resolve({ code: 1, output: `${output}${error.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 0, output }));
  });
}

function runBuild(root) {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"];
    outputChannel.appendLine(`Building ConstantX at ${root}`);
    outputChannel.appendLine(`$ ${process.platform === "win32" ? "npm run build" : [command, ...args].join(" ")}`);
    let child;
    try {
      child = childProcess.spawn(command, args, { cwd: root, windowsHide: true });
    } catch (error) {
      outputChannel.appendLine(`Failed to spawn build command: ${error.message}`);
      reject(error);
      return;
    }
    child.stdout.on("data", (chunk) => outputChannel.append(chunk.toString()));
    child.stderr.on("data", (chunk) => outputChannel.append(chunk.toString()));
    child.on("error", (error) => {
      outputChannel.appendLine(`Build process error: ${error.message}`);
      reject(error);
    });
    child.on("close", (code) => {
      if (code && code !== 0) {
        reject(new Error(`npm run build exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

function runtimeSettings() {
  const config = vscode.workspace.getConfiguration("constantx");
  const workspaceRoots = (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath);
  return {
    host: config.get("host", "127.0.0.1"),
    port: config.get("port", 4317),
    nodePath: config.get("nodePath", ""),
    autoStart: config.get("autoStart", true),
    allowedProjectRoots: uniquePaths([configuredProjectPath(), ...workspaceRoots])
  };
}

function endpoint() {
  const config = runtimeSettings();
  return `http://${config.host}:${config.port}/mcp`;
}

function configuredProjectPath() {
  const value = vscode.workspace.getConfiguration("constantx").get("projectPath", "");
  return value && value.trim() ? value.trim() : undefined;
}

function workspaceFolderPath() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function uniquePaths(values) {
  return [...new Set(values.filter((value) => value && value.trim()).map((value) => path.resolve(value.trim())))];
}

function constantxRoot(context) {
  const configured = vscode.workspace.getConfiguration("constantx").get("rootPath", "");
  if (configured && configured.trim()) {
    const configuredRoot = path.resolve(configured.trim());
    if (isConstantXRoot(configuredRoot)) return configuredRoot;
  }

  const bundledRoot = path.join(context.extensionPath, "server");
  if (isConstantXRoot(bundledRoot)) return bundledRoot;

  const workspace = workspaceFolderPath();
  if (workspace && isConstantXRoot(workspace)) return workspace;

  const devRoot = path.resolve(context.extensionPath, "..");
  if (isConstantXRoot(devRoot)) return devRoot;

  return configured && configured.trim() ? path.resolve(configured.trim()) : (workspace || devRoot);
}

function isConstantXRoot(root) {
  try {
    const packageFile = path.join(root, "package.json");
    if (!fs.existsSync(packageFile)) return false;
    const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
    return pkg.name === "constantx-mcp" || fs.existsSync(path.join(root, "src", "index.ts")) || fs.existsSync(path.join(root, "dist", "src", "index.js"));
  } catch {
    return false;
  }
}

async function requireValidConstantXRoot(context) {
  const root = constantxRoot(context);
  if (isConstantXRoot(root)) return root;

  const choice = await vscode.window.showErrorMessage(
    `ConstantX root is not configured correctly. Install the bundled ConstantX server or set constantx.rootPath to a valid ConstantX repo path, for example C:\\Users\\ayode\\deep-learning-research-implementation\\ConstantX. Current value: ${root}`,
    "Open Settings"
  );
  if (choice === "Open Settings") {
    await vscode.commands.executeCommand("workbench.action.openSettings", "constantx.rootPath");
  }
  return undefined;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\\/g, "\\\\").replace(/'/g, "&#39;");
}

module.exports = { activate, deactivate, renderStatusPanel };