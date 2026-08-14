# VS Code Extension

The ConstantX VS Code extension is an admin and visibility layer for the prompt-first MCP workflow. It does not replace Codex, Claude, or any other agent chat interface.

## Commands

- `ConstantX: Start Runtime` starts the shared local HTTP MCP runtime with `node dist/src/index.js --http`.
- `ConstantX: Stop Runtime` stops the runtime process started by this VS Code session.
- `ConstantX: Check Runtime` checks whether the configured HTTP MCP endpoint is reachable.
- `ConstantX: Connect Provider` generates MCP config for Codex, Claude, Generic MCP, or stdio fallback, writes it under `.constantx/provider-configs/`, opens it, and copies it to the clipboard.
- `ConstantX: Open Workflow Prompts` opens `C:\Users\ayode\.codex\ConstantX_workflow.md` when available, otherwise it opens `docs/workflow-commands.md`.
- `ConstantX: Open Status Panel` opens a styled Webview showing latest runs, jobs, logs, verification files, changed files, and patch paths.

## Settings

```json
{
  "constantx.host": "127.0.0.1",
  "constantx.port": 4317,
  "constantx.projectPath": ""
}
```

If `constantx.projectPath` is empty, the status panel reads the active workspace folder.

## Status Panel

The status panel uses a terminal-inspired ConstantX visual theme with green and purple accents:

- Green: completed, verified, or passed states.
- Purple: active or running states.
- Amber: waiting states.
- Red: failed states.

The panel supports:

- refresh
- open patch
- open logs
- open verification
- copy run id
- copy patch path
- inspect failed job
- apply patch after confirmation
- rerun verification commands

It reads these files from the selected project:

```text
.planner/runs.jsonl
.planner/jobs.jsonl
.planner/persistent/runs/<RUN_ID>/logs/
.planner/persistent/runs/<RUN_ID>/patches/final.patch
.planner/persistent/runs/<RUN_ID>/verification.md
.planner/persistent/runs/<RUN_ID>/artifacts/manifest.json
```


## First Run Setup

Run `ConstantX: First Run Setup` after installing the extension. It will:

- run the ConstantX build
- start the shared HTTP MCP runtime
- generate provider config files and install notes
- open workflow prompts
- open the status panel
- write a health-check report

Provider files are written under:

```text
.constantx/provider-configs/
```

ConstantX does not silently overwrite Codex, Claude, or other provider settings. Review the generated install notes, then merge the config manually into the provider's MCP settings.

## Health Check

Run `ConstantX: Health Check` to verify:

- Node runtime
- built MCP entrypoint
- HTTP MCP endpoint
- selected project path
- `.planner` state
- project config
- WSL distro detection

The report is written to:

```text
.constantx/health-check.md
```

## Packaging

Build the installable VS Code extension package:

```bash
npm --prefix vscode-extension run package
```

The package is written to:

```text
dist-vsix/constantx-vscode-0.1.0.vsix
```

Install it locally with:

```bash
code --install-extension dist-vsix/constantx-vscode-0.1.0.vsix
```
## Validation

Run extension validation with:

```bash
npm --prefix vscode-extension run check
```

The root verification command also runs extension validation:

```bash
npm run verify
```