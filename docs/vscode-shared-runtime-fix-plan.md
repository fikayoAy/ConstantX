# VS Code Shared Runtime Fix Plan

This plan upgrades the ConstantX VS Code extension from a command-started helper into a supervised shared runtime that starts automatically, survives VS Code reloads, and proves MCP readiness before Codex or another provider connects.

## Implementation Checklist

- [x] Add runtime health endpoints.
- [x] Introduce a VS Code runtime manager.
- [x] Make the runtime independent of the extension host.
- [x] Add automatic startup and supervision.
- [x] Correct command behavior.
- [x] Improve Codex onboarding.
- [x] Improve failure reporting.
- [x] Add automated tests.
- [x] Run local packaged-runtime and conflict smoke checks.
- [ ] Run full clean VS Code / Marketplace release checks.
- [ ] Publish corrected release as `0.1.5`.

## 1. Runtime Health Endpoints

- `GET /health` returns service name, version, PID, start time, status, and endpoint.
- `/mcp` remains exclusively for MCP POST requests.
- MCP readiness checks must perform `initialize` and `tools/list`.

## 2. VS Code Runtime Manager

- Move process management out of `extension.js`.
- Store runtime metadata under `%LOCALAPPDATA%\ConstantX\runtime.json`.
- Store runtime logs under `%LOCALAPPDATA%\ConstantX\logs`.
- Detect and adopt an existing healthy ConstantX process.
- Prevent multiple VS Code windows from launching duplicate runtimes.
- Detect stale PID records safely.
- Never terminate an unrelated process occupying port `4317`.

## 3. Runtime Independence

- Launch the bundled server as a detached process.
- Use VS Code's Electron executable with `ELECTRON_RUN_AS_NODE=1`.
- Do not require Node.js or the ConstantX repository on the user's machine.
- Stage the executable server under `%LOCALAPPDATA%\ConstantX\server\<VERSION>` so the runtime does not lock the installed extension directory.
- Pass active workspace folders and `constantx.projectPath` into the server project-root allowlist.
- Restart the verified runtime with merged roots when a new workspace is opened.
- Allow VS Code reloads without stopping the runtime.
- Make `Stop Runtime` terminate only the verified ConstantX process.

## 4. Automatic Startup And Supervision

- Add `onStartupFinished` activation.
- Add `constantx.autoStart`, enabled by default.
- Call `ensureRuntime()` during extension activation.
- Wait for `/health` and MCP readiness before reporting success.
- Restart unexpected crashes with bounded exponential backoff.
- Stop restarting after repeated failures and show the exact log path.

## 5. Command Behavior

- `First Run Setup`: start runtime, verify MCP, generate provider configuration, then instruct the user to restart the provider.
- `Connect Provider`: ensure the runtime is ready before generating configuration.
- `Start Runtime`: become idempotent and adopt an existing process.
- `Check Runtime`: test `/health`, MCP initialization, and `tools/list`.
- `Health Check`: report process, endpoint, MCP tools, config, logs, and detected conflicts.

## 6. Codex Onboarding

- Validate `%USERPROFILE%\.codex\config.toml`.
- Detect duplicate `[mcp_servers.ConstantX]` sections.
- Create a backup before offering to update the config.
- Verify that the configured URL matches the running endpoint.
- Explain that Codex must restart or open a new session after its MCP configuration changes.

## 7. Failure Reporting

- Add a ConstantX status-bar indicator: `Starting`, `Ready`, `Stopped`, `Conflict`, or `Crashed`.
- Include a direct command to open runtime logs.
- Report port conflicts, launch errors, missing bundled files, invalid settings, and MCP protocol failures separately.

## Automated Tests

- Unit tests for stale PIDs, duplicate starts, manual stops, crashes, restart limits, port conflicts, and runtime adoption.
- Server integration tests for `/health`, MCP `initialize`, `tools/list`, malformed requests, and shutdown.
- Concurrency test where two VS Code windows attempt to start ConstantX simultaneously.
- Crash-recovery test that kills the runtime and confirms automatic restart.
- Reload test confirming the detached runtime survives extension-host reload.
- Packaged-server test using only files extracted from the VSIX.
- Test with no external Node.js installation.
- Test with invalid `constantx.rootPath`, confirming the bundled server is still selected.
- Provider-config tests for Codex TOML, Claude Code, generic HTTP MCP, and stdio fallback.

## Real-World Release Tests

1. Install the VSIX into a clean VS Code Insiders profile with separate user-data and extension directories.
2. Confirm port `4317` starts automatically without running a ConstantX command.
3. Run `ConstantX: Health Check` and require all runtime and MCP checks to pass.
4. Configure Codex from the generated TOML, restart Codex, and confirm ConstantX appears in its MCP tools.
5. Ask Codex to list ConstantX workflow tools and confirm the five workflow families are discoverable.
6. Reload VS Code and verify ConstantX remains available.
7. Open a second VS Code window and verify no duplicate runtime is created.
8. Kill the runtime process and verify automatic recovery.
9. Occupy port `4317` with an unrelated process and verify ConstantX reports a conflict without killing it.
10. Install the Marketplace package on a separate clean Windows account and repeat the Codex test.

The release passes only when Codex discovers ConstantX directly, no Weave fallback occurs, and the Marketplace-installed extension works without the source repository or external Node.js.
