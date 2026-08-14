# ConstantX v1 Shared Runtime And WSL2 Execution Plan

ConstantX v1 remains a prompt-first MCP workflow. Codex, Claude, or another agent owns the conversation. ConstantX owns engineering state, workflow gates, runtime execution, logs, patches, and verification.

The public workflow remains exactly five MCP workflow families:

```text
workflow.start_project
workflow.write_blocks
workflow.refine
workflow.gather_evidence
workflow.implement
```

The user-facing prompt style remains:

```text
Use ConstantX. Start project ...
Use ConstantX. Write the approved blocks ...
Use ConstantX. Refine ...
Use ConstantX. Gather evidence ...
Use ConstantX. Implement ...
```

## Product Boundary

ConstantX should not become a replacement chat interface.

```text
Codex / Claude / Agent
  -> normal chat
  -> calls ConstantX MCP tools

ConstantX
  -> stores project state
  -> enforces gates
  -> runs implementation jobs
  -> records logs, patches, and verification evidence
```

## Core Architecture

```text
VS Code Extension
  -> installs/builds ConstantX
  -> starts/checks ConstantX shared runtime
  -> connects Codex, Claude, or generic MCP agents
  -> shows prompts, status, runs, logs, and patch paths

ConstantX Shared Runtime
  -> HTTP MCP endpoint
  -> stdio MCP fallback
  -> PlannerStore
  -> approval gates
  -> WSL2 runtime
  -> job runner
  -> verification runner
  -> patch exporter
  -> persistent run store
```

## Runtime Modes

Primary mode:

```text
http://127.0.0.1:4317/mcp
```

Fallback mode:

```text
node dist/src/index.js
```

The VS Code extension should prefer HTTP MCP for providers that support it, and fall back to stdio MCP for providers that do not.

## Provider Connection

HTTP MCP configuration:

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

Stdio fallback configuration:

```json
{
  "mcpServers": {
    "ConstantX": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/.../ConstantX/dist/src/index.js"]
    }
  }
}
```

## WSL2 Runtime Direction

WSL2 is the v1 sandbox direction. Firecracker remains a later stronger runtime backend.

The runtime must not assume Ubuntu. It should detect every installed WSL distro and let the user choose or configure the one ConstantX should use.

Detection command:

```powershell
wsl.exe --list --verbose
```

Selection order:

```text
1. Use execution.wslDistro from deep-research.config.json if set.
2. Otherwise use the current WSL default distro if available.
3. Otherwise show detected distros in VS Code and ask the user to choose.
4. If no distro exists, show setup instructions and ask the user whether to fall back to local-project execution. Do not use local-project execution silently.
```

Supported distro examples:

```text
Ubuntu
Debian
openSUSE
Kali
Arch-based custom distro
Any WSL2 distro that can run the required agent, package manager, and verification commands
```

The WSL2 runtime must verify:

```text
wsl.exe exists
selected distro exists
selected distro is WSL2 when possible
node/git are available if required by the project
agent backend is available if execution requires it
project workspace can be copied into the distro
verification commands can run from the copied workspace
```

## Local-Project Fallback

If WSL is missing or no usable WSL distro exists, ConstantX should offer a local-project fallback instead of failing the entire workflow.

This fallback must be explicit:

```text
ConstantX could not find a usable WSL2 distro.
Local-project execution can continue, but it is less isolated and may mutate or depend on the user's local environment.
Do you want to continue with local-project execution for this run?
```

Fallback rules:

```text
ask the user before every first local-project fallback for a project
record the user's decision in the run/job record
mark runtime as local-project
still create persistent run/job records
still run verification commands
still capture logs and changed files
prefer patch-first behavior where possible
never present local-project fallback as equivalent to WSL2 isolation
```

Security ranking for v1:

```text
WSL2 job workspace > local-project fallback > direct untracked manual edits
```

Local-project fallback is for convenience and compatibility. It is not a sandbox boundary.

## WSL2 Implementation Flow

```text
workflow.implement
  -> validate planner gates
  -> approve spec if needed
  -> prepare full strict implementation context
  -> create run record
  -> create job record
  -> acquire project/block lock
  -> select configured or detected WSL2 distro
  -> create WSL2 ephemeral workspace
  -> copy repo into WSL2 workspace
  -> run selected agent/backend inside copied workspace
  -> run verification commands inside copied workspace
  -> export patch/logs/artifacts
  -> store persistent results
  -> delete or retain ephemeral workspace by config
  -> record implementation
  -> verify block if checks passed
  -> release lock
```

No token slicing in v1. The model should receive the full approved context for reliability.

## Storage Layout

```text
<PROJECT_PATH>/
  .planner/
    state.json
    graph.json
    audit-log.jsonl
    runs.jsonl
    jobs.jsonl

    persistent/
      runs/
        R-001/
          run.json
          job.json
          implementation-context.md
          spec.md
          requirements.md
          decisions.md
          verification.md
          test-results.json
          logs/
            implementation.log
            verify.log
          patches/
            final.patch
          artifacts/
            manifest.json

    ephemeral/
      jobs/
        J-001/
          repo/
          tmp/
          build/
          test-db/
```

Storage rule:

```text
persistent = auditable workflow state
ephemeral = disposable execution state
```

## Job Model

For v1:

```text
1 workflow.implement call = 1 run = 1 job
```

Concurrency rule:

```text
default max active jobs per project = 1
only one active job per block
additional implementation requests queue
```

This prevents two agents from mutating or patching the same project at the same time.

## Configuration

Add project config:

```json
{
  "execution": {
    "runtime": "wsl2",
    "wslDistro": "Ubuntu",
    "timeoutSeconds": 1800,
    "cleanupEphemeral": true,
    "maxActiveJobs": 1
  },
  "agent": {
    "provider": "codex"
  },
  "verification": {
    "commands": [
      "npm run build",
      "npm test"
    ]
  },
  "mcp": {
    "mode": "http",
    "host": "127.0.0.1",
    "port": 4317
  }
}
```

If `execution.wslDistro` is omitted, ConstantX detects available WSL distros and uses the selection order above. If no usable WSL distro exists, ConstantX must ask the user before falling back to local-project execution because it is less isolated than WSL2.

## Patch-First Safety

Do not mutate the real repo directly.

```text
real repo
  -> copied into WSL2 job workspace
  -> agent edits copied repo
  -> verification runs in copied repo
  -> final.patch exported
  -> persistent run stores patch/logs/evidence
```

Patch application should remain under `workflow.implement`, not a sixth public workflow family.

Default:

```text
applyPatch=false
```

Future option:

```text
applyPatch=true
```

## VS Code Extension Scope

The extension handles setup and visibility, not chat.

Extension responsibilities:

```text
install/build ConstantX
start/stop/check HTTP runtime
connect Codex
connect Claude
generate generic MCP config
open workflow prompt templates
show basic status panel
show latest runs/jobs/logs/patch path
```

Extension utility commands:

```text
ConstantX: Connect Provider
ConstantX: Start Runtime
ConstantX: Stop Runtime
ConstantX: Check Runtime
ConstantX: Open Workflow Prompts
ConstantX: Open Status Panel
```

These are setup/admin commands, not workflow families.

## v1 Includes

```text
shared local HTTP MCP runtime
stdio MCP fallback
VS Code installer/connector
prompt-template helper
basic status panel
full strict context
WSL2 runtime with distro detection and explicit local-project fallback
persistent/ephemeral storage split
run/job records
single-job queue
verification command execution
patch export
implementation/verification record updates
```

## v1 Does Not Include

```text
CLI workflow
custom chat UI
token-efficient context slicing
native Windows Firecracker
remote workers
multi-machine orchestration
complex dashboard
```

## Implementation Order

```text
1. Add config loader.
2. Add persistent and ephemeral storage layout.
3. Add run/job record model.
4. Add WSL distro detection and explicit local-project fallback prompt.
5. Add WSL2 runtime abstraction plus local-project runtime fallback.
6. Add single-job queue and block/project locks.
7. Add verification runner.
8. Add patch exporter.
9. Upgrade workflow.implement orchestration.
10. Add shared HTTP MCP service mode.
11. Add stdio fallback preservation.
12. Add VS Code extension installer/connector.
13. Add basic status panel.
14. Add tests for config, WSL detection, local-project fallback prompts, job records, patch export, and workflow.implement.
```
## Implementation Status

- [x] Config loader for `deep-research.config.json` and `constantx.config.json`.
- [x] Persistent and ephemeral storage layout under `.planner/`.
- [x] Run and job records in `.planner/runs.jsonl`, `.planner/jobs.jsonl`, and `.planner/persistent/runs/<RUN_ID>/`.
- [x] WSL distro detection that does not assume Ubuntu.
- [x] Explicit local-project fallback prompt and approval flag.
- [x] Runtime abstraction with local-project and WSL2 implementations.
- [x] Single project/block lock for implementation jobs.
- [x] Verification command execution from project config.
- [x] Patch export to `.planner/persistent/runs/<RUN_ID>/patches/final.patch`.
- [x] `workflow.implement` orchestration hook without adding a sixth workflow family.
- [x] Shared Streamable HTTP MCP mode with stdio fallback preserved.
- [x] VS Code extension skeleton.
- [x] VS Code command: `ConstantX: Start Runtime`.
- [x] VS Code command: `ConstantX: Stop Runtime`.
- [x] VS Code command: `ConstantX: Check Runtime`.
- [x] VS Code command: `ConstantX: Connect Provider`.
- [x] VS Code command: `ConstantX: Open Workflow Prompts`.
- [x] VS Code command: `ConstantX: Open Status Panel`.
- [x] Status panel Webview for latest `.planner/runs.jsonl`, `.planner/jobs.jsonl`, logs, verification files, changed files, and patch paths.
- [x] Status panel visual theme using a stylish terminal-inspired layout with ConstantX green and purple status accents.
- [x] Status panel actions: refresh, open patch, open logs, open verification, copy run id, and copy patch path.
- [x] VS Code runtime launcher for `node dist/src/index.js --http`.
- [x] Provider MCP config generator for Codex, Claude, and generic MCP clients using `http://127.0.0.1:4317/mcp`.
- [x] VS Code extension build and validation tests.
- [x] Safe exported-patch review/apply support under `workflow.implement` without adding a sixth workflow family.
- [x] Failed-job inspection support.
- [x] Verification rerun support for failed or stale runtime jobs.
## Packaging Status

- [x] VS Code extension packaging metadata, icon, README, LICENSE, and `.vscodeignore`.
- [x] Installable VSIX build script: `npm --prefix vscode-extension run package`.
- [x] First-run setup command for build, runtime start, provider config generation, prompt opening, status panel, and health report.
- [x] Health-check command for Node, MCP entrypoint, HTTP runtime, planner state, config, and WSL distro detection.
- [x] Provider-specific generated install notes without silently overwriting user provider config files.