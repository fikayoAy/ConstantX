# ConstantX
<p align="center">
  <img src="assets/logo.png" alt="ConstantX logo" width="180" />
</p>
ConstantX is an MCP engineering workflow that turns a markdown plan into small, inspectable implementation blocks, gathers block-specific evidence, lets you refine the design before code, and gates implementation behind approved specs, verification, and traceable project files.

Use it from Codex only when your prompt starts like this:

```text
Use ConstantX. <workflow action>
```

## Watch It Work

### Installation Walkthrough

Installing the ConstantX VS Code extension, starting the shared MCP runtime, and connecting the tool for use from an agent.

![Installation walkthrough](assets/installation.gif)

### Workflow In Practice

Using ConstantX on a real plan so the agent decomposes the work, writes block files, gathers evidence, and moves through the gated workflow.

![Workflow in practice](<assets/workflow_overview .gif>)

## Example: Small Neural Network

The [small neural network example](small_neural_network/) shows the workflow in practice. A short markdown plan is converted into a managed project for a PyTorch addition model, with source code, tests, artifacts, planner state, evidence, and block files kept inspectable.

ConstantX breaks the example into focused blocks instead of one large generated implementation:

| Block | Purpose |
| --- | --- |
| [`B-001`](small_neural_network/blocks/B-001-goal-model-scope/) | Defines the addition task, model scope, dataset range, and supported inputs. |
| [`B-002`](small_neural_network/blocks/B-002-implementation-expectations-acceptance-criteria/) | Captures implementation expectations and acceptance criteria for training, evaluation, save/load, and inference. |
| [`B-003`](small_neural_network/blocks/B-003-non-goals-verification/) | Records non-goals, verification requirements, tests, and scope guardrails. |

The final project includes a runnable [`addition_nn`](small_neural_network/addition_nn/) package and [`tests`](small_neural_network/tests/) so the generated work can be inspected, tested, and traced back to the original plan.

## Why The File Breakdown Matters

ConstantX takes a large markdown plan and breaks it into small, inspectable files instead of leaving the model to work from one huge prompt or one large generated artifact.

Each block becomes a managed folder with focused markdown artifacts such as `block.md`, `criteria.md`, `criteria-diff.md`, `pins.md`, `papers.md`, `extracted-research.md`, `annotation-<BLOCK_ID>.md`, `design-session.md`, `directives.md`, `spec.md`, and `implementation.md`.

That structure makes the workflow easier to review because every stage has a small surface area: the original plan is traceable, block responsibilities are explicit, evidence stays block-specific, user design decisions are recorded, specs are concrete, and implementation only starts after the relevant files have been approved.
The resulting implementations are also split into focused scripts, making them easier to inspect instead of being stuffed into one or two large blobs of code.

## Documentation

- [Installation](docs/installation.md)
- [Codex Opt-In Setup](docs/codex-opt-in.md)
- [Project Layout](docs/project-layout.md)
- [Workflow Commands](docs/workflow-commands.md)
- [Shared Runtime And WSL2](docs/runtime-wsl2.md)
- [VS Code Extension](docs/vscode-extension.md)
- [Release Checklist](docs/release.md)
- [Block Design Sessions](docs/block-design-sessions.md)
- [Rules And Troubleshooting](docs/rules-and-troubleshooting.md)
- [MNIST Worked Example](docs/mnist-example.md)

## What It Does

- Decomposes a markdown plan into semantic implementation blocks from the actual plan, not generic phases.
- Stores each block as markdown artifacts for acceptance criteria, criteria diffs, evidence, pins, design sessions, directives, specs, and implementation records.
- Lets Codex gather broad evidence: papers, official docs, repositories, datasets, benchmarks, model cards, API docs, implementation examples, user files, and local project files.
- Creates original-plan acceptance criteria upfront, embeds them in each block, and pins them with inline `[n]` checkpoints backed by `criteria.md`, `criteria-diff.md`, and `pins.md`.
- Converts approved design decisions into implementation directives and concrete specs before implementation, with block refinement automatically recorded in `annotation-<BLOCK_ID>.md` and `design-session.md`.
- Preserves strict gates so implementation starts only after approved research, approved spec, dependencies, strict implementation context, criteria coverage evidence, and non-minimal implementation requirements.

![Five-command MCP workflow from plan to verified implementation](assets/plan.png)

## Quick Start

```bash
npm install
npm run build
```

Add the MCP server to Codex:

```json
{
  "mcpServers": {
    "ConstantX": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH_TO_REPO>/dist/src/index.js"]
    }
  }
}
```

Then restart Codex.


## Runtime Execution

`workflow.implement` now creates persistent run/job records and can execute configured implementation and verification commands in a copied runtime workspace. WSL2 is the preferred v1 runtime, with distro detection across all installed WSL distros. If WSL2 is unavailable, ConstantX asks for explicit local-project fallback approval because it is less isolated.

See [Shared Runtime And WSL2](docs/runtime-wsl2.md) for config, HTTP MCP mode, logs, patches, and fallback behavior.
## Collaboration Context

ConstantX workflow commands accept optional collaboration context so audit logs, planner state, and graph output can show who performed each action and what scope was allowed.

```text
Actor: <NAME>
Role: owner | researcher | reviewer | implementer | verifier
Scope: project | B-001 | B-001, B-002 | artifact: <PATH>
Intent: <WHAT YOU ARE DOING>
Execution mode: review-only | draft | approve | implement | reimplement | verify-only
```

Example:

```text
Use ConstantX. Refine block B-001 in project <PROJECT_PATH>.

Actor: ayode
Role: owner
Scope: B-001
Intent: refine design before spec generation
Execution mode: review-only

I want to decide whether this block should use SAM 2 or Mask2Former.
Do not create the spec or implement yet.
```

If no actor is supplied, ConstantX records the action as `local-user` for backward compatibility. Role and scope gates reject invalid write actions where collaboration context is provided. See [Multi-User Collaboration Provenance](docs/multi-user-collaboration-plan.md).

## Main Prompt Shape

```text
Use ConstantX. Start project <PROJECT_PATH> from plan <PLAN_MARKDOWN_PATH> with language <LANGUAGE> and framework <FRAMEWORK>. Propose no more than <MAX_BLOCKS> blocks. Do not write blocks until I approve.
```

Continue with the five command families in [Workflow Commands](docs/workflow-commands.md). Use [Block Design Sessions](docs/block-design-sessions.md) for the refinement loop before `spec.md` is finalized.



