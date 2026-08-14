# Shared Runtime And WSL2

ConstantX v1 keeps the five public workflow families unchanged. Runtime behavior is configured underneath `workflow.implement`.

## Config

Create `deep-research.config.json` or `constantx.config.json` in the planner project:

```json
{
  "execution": {
    "runtime": "wsl2",
    "wslDistro": "Debian",
    "timeoutSeconds": 1800,
    "cleanupEphemeral": true,
    "maxActiveJobs": 1,
    "localProjectFallbackApproved": false,
    "implementationCommands": []
  },
  "verification": {
    "commands": ["npm run build", "npm test"]
  },
  "agent": {
    "provider": "codex"
  },
  "mcp": {
    "mode": "http",
    "host": "127.0.0.1",
    "port": 4317
  }
}
```

If `implementationCommands` is empty, ConstantX creates the run/job record and returns strict implementation context for the calling agent to use. If commands are provided, they run in the copied runtime workspace.

## WSL2 Selection

ConstantX detects installed distros with `wsl.exe --list --verbose` and does not assume Ubuntu. Selection order:

1. Use `execution.wslDistro` if configured.
2. Otherwise use the default WSL distro.
3. If no usable WSL2 distro exists, return an explicit local-project fallback prompt.

Local-project fallback is less isolated and must be explicitly approved with `localProjectFallbackApproved=true` or the config equivalent.

## Runtime Outputs

`workflow.implement` writes runtime state under `.planner/`:

```text
.planner/runs.jsonl
.planner/jobs.jsonl
.planner/persistent/runs/<RUN_ID>/run.json
.planner/persistent/runs/<RUN_ID>/job.json
.planner/persistent/runs/<RUN_ID>/implementation-context.md
.planner/persistent/runs/<RUN_ID>/verification.md
.planner/persistent/runs/<RUN_ID>/test-results.json
.planner/persistent/runs/<RUN_ID>/logs/
.planner/persistent/runs/<RUN_ID>/patches/final.patch
.planner/persistent/runs/<RUN_ID>/artifacts/manifest.json
.planner/ephemeral/jobs/<JOB_ID>/
```

Ephemeral workspaces are disposable. Persistent run records, logs, verification output, and patches are auditable.

## HTTP MCP Mode

Stdio remains the default:

```bash
node dist/src/index.js
```

Start the shared local HTTP runtime with:

```bash
node dist/src/index.js --http
```

Or with environment variables:

```bash
CONSTANTX_MCP_MODE=http CONSTANTX_MCP_HOST=127.0.0.1 CONSTANTX_MCP_PORT=4317 node dist/src/index.js
```

HTTP MCP provider config:

```json
{
  "mcpServers": {
    "ConstantX": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:4317/mcp"
    }
  }
}
```

Stdio fallback config:

```json
{
  "mcpServers": {
    "ConstantX": {
      "type": "stdio",
      "command": "node",
      "args": ["<ABSOLUTE_PATH_TO_REPO>/dist/src/index.js"]
    }
  }
}
```
## Runtime Controls

Runtime controls stay under `workflow.implement`; they do not add a sixth workflow family.

Inspect a run:

```text
Use ConstantX. Implement block <BLOCK_ID> in project <PROJECT_PATH> with runtimeAction inspect-run and runId <RUN_ID>. Do not implement new code.
```

Apply a reviewed patch:

```text
Use ConstantX. Implement block <BLOCK_ID> in project <PROJECT_PATH> with runtimeAction apply-patch, runId <RUN_ID>, and applyPatchApproved true.
```

Rerun verification:

```text
Use ConstantX. Implement block <BLOCK_ID> in project <PROJECT_PATH> with runtimeAction rerun-verification and runId <RUN_ID>. Do not implement new code.
```

Patch apply is guarded by `git apply --check` and requires `applyPatchApproved=true`. Control events are appended to `.planner/runtime-controls.jsonl`.