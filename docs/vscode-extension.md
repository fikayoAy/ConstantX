# ConstantX VS Code Extension

The ConstantX VS Code extension is the admin and visibility layer for the prompt-first MCP workflow. In `0.1.3`, it starts and supervises the shared local HTTP MCP runtime automatically, using the bundled server inside the extension by default.

## Commands

- `ConstantX: First Run Setup` starts the runtime, verifies MCP readiness, generates provider config files, optionally updates Codex config with a backup, opens workflow prompts, opens the status panel, and writes a health report.
- `ConstantX: Start Runtime` idempotently starts or adopts a healthy shared ConstantX runtime.
- `ConstantX: Stop Runtime` stops only the verified ConstantX runtime recorded in `%LOCALAPPDATA%\ConstantX\runtime.json`.
- `ConstantX: Check Runtime` checks `/health`, MCP `initialize`, and MCP `tools/list`.
- `ConstantX: Health Check` reports process, endpoint, MCP tools, Codex config state, logs, project files, and WSL detection.
- `ConstantX: Connect Provider` verifies the runtime first, then generates MCP config for Codex, Claude Code, Generic MCP, or stdio fallback.
- `ConstantX: Open Runtime Logs` opens the active runtime log under `%LOCALAPPDATA%\ConstantX\logs`.
- `ConstantX: Open Workflow Prompts` opens the workflow prompt reference.
- `ConstantX: Open Status Panel` opens the styled Webview for runs, jobs, logs, verification files, and patch paths.

## Settings

```json
{
  "constantx.autoStart": true,
  "constantx.rootPath": "",
  "constantx.nodePath": "",
  "constantx.host": "127.0.0.1",
  "constantx.port": 4317,
  "constantx.projectPath": ""
}
```

For normal VSIX or Marketplace installation, leave `constantx.rootPath` empty. The extension uses its bundled MCP server and launches it with VS Code's Electron executable via `ELECTRON_RUN_AS_NODE=1`, so users do not need the ConstantX source repo or a separate Node.js installation. Set `constantx.rootPath` only when developing against a local ConstantX repo.

## Runtime Files

```text
%LOCALAPPDATA%\ConstantX\runtime.json
%LOCALAPPDATA%\ConstantX\logs\runtime-<timestamp>.log
%LOCALAPPDATA%\ConstantX\server\0.1.3\
```

The runtime is detached from the extension host and runs from the staged `%LOCALAPPDATA%` server copy, so it can survive VS Code reloads without locking the installed extension directory. The active workspace and `constantx.projectPath` are passed as allowed project roots. If a new workspace is not in the running process allowlist, ConstantX safely restarts its verified runtime with the merged roots. Multiple VS Code windows adopt the same healthy runtime instead of launching duplicates. If port `4317` is occupied by another process, ConstantX reports a conflict and refuses to kill it.

## Provider Setup

Codex uses TOML:

```toml
[mcp_servers.ConstantX]
url = "http://127.0.0.1:4317/mcp"
enabled = true
```

`ConstantX: Connect Provider` and `ConstantX: First Run Setup` detect duplicate `[mcp_servers.ConstantX]` sections in `%USERPROFILE%\.codex\config.toml`. When updating Codex config, the extension creates a timestamped backup first. Restart Codex or open a new Codex session after changing MCP config.

## Status Panel

The status panel shows latest runs, jobs, logs, verification files, changed files, and patch paths from the selected project:

```text
.planner/runs.jsonl
.planner/jobs.jsonl
.planner/persistent/runs/<RUN_ID>/logs/
.planner/persistent/runs/<RUN_ID>/patches/final.patch
.planner/persistent/runs/<RUN_ID>/verification.md
.planner/persistent/runs/<RUN_ID>/artifacts/manifest.json
```

## Packaging

Build the installable VS Code extension package:

```bash
npm --prefix vscode-extension run package
```

The package is written to:

```text
dist-vsix/constantx-vscode-0.1.3.vsix
```

## Validation

```bash
npm run verify
npm --prefix vscode-extension run package
```