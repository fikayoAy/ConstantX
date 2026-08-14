# Release Checklist

Use this checklist before sharing ConstantX.

## Verify

```bash
npm run verify
npm --prefix vscode-extension run package
```

Expected outputs:

```text
11 MCP/runtime tests passed
5 VS Code extension tests passed
dist-vsix/constantx-vscode-0.1.0.vsix
```

## Install Locally

```bash
code --install-extension dist-vsix/constantx-vscode-0.1.0.vsix
```

Then run these VS Code commands:

```text
ConstantX: First Run Setup
ConstantX: Health Check
ConstantX: Connect Provider
ConstantX: Open Status Panel
```

## Provider Setup

Generated provider files are written to:

```text
.constantx/provider-configs/
```

Review the generated install notes before changing Codex, Claude, or any other MCP client config. ConstantX should not silently overwrite user provider settings.

## Runtime Smoke Test

1. Open a planner project in VS Code.
2. Run `ConstantX: Start Runtime`.
3. Run `ConstantX: Check Runtime`.
4. Run `ConstantX: Open Status Panel`.
5. Confirm runs, jobs, logs, verification files, and patches render correctly.

## Git Cleanup

Before committing:

```bash
git status --short
npm run verify
```

Confirm deleted assets are intentional and generated package output under `dist-vsix/` is ignored.