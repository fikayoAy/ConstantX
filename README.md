# deep_learning_auto_research

`deep_learning_auto_research` is an opt-in MCP workflow for Codex. It turns a markdown system plan into traceable implementation blocks, gathers block-specific evidence, supports user-guided redesign before specs, and gates code implementation behind approved research, approved specs, and strict implementation context.

Use it from Codex only when your prompt starts like this:

```text
Use deep_learning_auto_research. <workflow action>
```

![deep_learning_auto_research hero](assets/ChatGPT%20Image%20Jul%2023%2C%202026%2C%2001_54_24%20PM.png)

## What It Does

- Decomposes a markdown plan into semantic implementation blocks from the actual plan, not generic phases.
- Stores each block as markdown: `block.md`, `papers.md`, `extracted-research.md`, `pins.md`, `design-session.md`, `annotation-<BLOCK_ID>.md`, `directives.md`, `spec.md`, and `implementation.md`.
- Lets Codex gather broad evidence: papers, official docs, repositories, datasets, benchmarks, model cards, API docs, implementation examples, user files, and local project files.
- Creates internal design pins from the original plan, block package, extracted evidence, directives, and existing specs so redesign discussions stay anchored.
- Converts approved design decisions into implementation directives and concrete specs before implementation.
- Exposes consolidated `workflow.*` tools while preserving strict approval gates before coding.

![Research-gated implementation workflow](assets/workflow.svg)

## Installation

Prerequisites:

- Node.js
- npm
- Codex with MCP server support

Build the server:

```bash
npm install
npm run build
```

Server entrypoint:

```bash
node dist/src/index.js
```

Add it to your Codex MCP config:

```json
{
  "mcpServers": {
    "deep_learning_auto_research": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH_TO_REPO>/dist/src/index.js"]
    }
  }
}
```

Restart Codex after changing MCP config or rebuilding the server.

## Codex Opt-In Rule

Add this to your global `AGENTS.md` so the tool is used only when requested:

```md
[Tools]

deep_learning_auto_research is opt-in only.

Use the deep_learning_auto_research MCP server only when I explicitly ask with a prompt that starts with or clearly includes "Use deep_learning_auto_research" or "Use the deep_learning_auto_research MCP workflow".

Do not use deep_learning_auto_research automatically for normal coding, debugging, editing, explanation, refactoring, terminal, or research tasks.

When deep_learning_auto_research is invoked, follow the requested MCP stage exactly and do not advance to another stage unless I ask.
```

## Project Layout

A planner project is stored inside your chosen `<PROJECT_PATH>`:

```text
<PROJECT_PATH>/
  .planner/
    state.json
    graph.json
    audit-log.jsonl
  blocks/
    B-001-.../
      block.md
      papers.md                    # evidence references, not only papers
      extracted-research.md
      pins.md                      # internal source/evidence checkpoints
      design-session.md            # redesign conversation state
      annotation-B-001.md          # user redesign notes captured by Codex
      directives.md                # approved implementation decisions
      spec.md
      implementation.md
  papers/
    P-001-...md
  graph.md
  system-plan.md
```

## Main Workflow

The workflow has five user-facing stages. Stage 4 is a short design session, not repeated manual annotation commands.

| Stage | MCP tool path |
| --- | --- |
| Start project | `workflow.start_project` |
| Approve plan blocks | `workflow.approve_plan_blocks` |
| Gather evidence | `workflow.gather_evidence` |
| Design the block | `workflow.start_block_design_session`, internal `workflow.record_block_design_turn`, then `workflow.finalize_block_design_session` |
| Implement and verify | `workflow.implement_and_verify_block` |

Lower-level `planner.*` tools still exist for advanced/manual control. Normal use should follow the workflow tools.

## 1. Start Project

```text
Use deep_learning_auto_research. Start project <PROJECT_PATH> from plan <PLAN_MARKDOWN_PATH> with language <LANGUAGE> and framework <FRAMEWORK>. Propose no more than <MAX_BLOCKS> blocks. Do not write blocks until I approve.
```

This creates the project, ingests the plan, sets the implementation target, and proposes blocks. It stops before writing block folders.

## 2. Approve Plan Blocks

```text
Use deep_learning_auto_research. Approve and write the proposed blocks for project <PROJECT_PATH>.
```

This writes the approved decomposition, creates block folders, and exports the graph. It stops before evidence gathering.

## 3. Gather Evidence

```text
Use deep_learning_auto_research. Gather evidence for block <BLOCK_ID> in project <PROJECT_PATH>. Search online and use any user-provided files. Extract only <BLOCK_ID>-specific evidence. Do not approve or implement.
```

This stage lets Codex search online, attach useful evidence references/files, and write `extracted-research.md`. Evidence is not limited to papers.

## 4. Design The Block

Start a design session:

```text
Use deep_learning_auto_research. Start a block design session for <BLOCK_ID> in project <PROJECT_PATH>. Generate internal pins from the original plan, block.md, papers.md, extracted-research.md, directives.md, and spec.md so we can redesign this block before spec generation. Do not approve, create specs, or implement.
```

During the discussion, you can speak normally. Codex should compare your requested changes against the generated pins, block scope, extracted evidence, and existing directives, then internally call `workflow.record_block_design_turn` to update `annotation-<BLOCK_ID>.md` and `design-session.md`. You do not need to manage pin ids or send repeated annotation commands.

Finalize when the redesign is done:

```text
Use deep_learning_auto_research. Finalize the block design session for <BLOCK_ID> in project <PROJECT_PATH>. Convert approved decisions into implementation directives, approve research if ready, create spec.md, and show it for review. Do not approve spec or implement.
```

The generated `spec.md` must cite the finalized design pins, approved directives, implementation target, evidence/model fit, exact files/artifacts to create or modify, artifacts to remove or replace, non-goals, acceptance criteria, verification plan, and traceability.

![Annotation and directive loop](assets/redirection_loop.png)

## 5. Implement And Verify

```text
Use deep_learning_auto_research. Approve spec, implement, record, and verify block <BLOCK_ID> in project <PROJECT_PATH>.
```

This is the only workflow stage that writes implementation code. It approves the reviewed spec if needed, prepares strict implementation context, implements only that block, records changed files, runs verification, and marks the block verified.

Use reimplementation only when you intentionally want to redo a completed block:

```text
Use deep_learning_auto_research. Reimplement, record, and verify block <BLOCK_ID> in project <PROJECT_PATH>.
```

## Final Code Context

After all blocks are implemented or verified:

```text
Use deep_learning_auto_research. Prepare final code context for project <PROJECT_PATH> in strict mode after all blocks are implemented or verified.
```

## Rules

- The workflow is opt-in and should only run when you explicitly say `Use deep_learning_auto_research`.
- `<PROJECT_PATH>` is a directory, not the plan file path.
- Set language and framework before specs or implementation.
- Evidence extraction must be block-specific.
- Design pins are internal checkpoints; users do not manage them manually.
- An annotation/design note does not advance workflow status.
- A directive is an approved implementation decision and must appear in `spec.md` and strict implementation context.
- Specs must be concrete, non-placeholder, target-specific, directive-aware, evidence/model-aware, and traceable to block sources and finalized pins.
- Implementation starts only after strict implementation context succeeds.
- Dependencies must be implemented or verified before dependent blocks are implemented.
- `mode reimplement` allows redoing a completed block, but it does not bypass strict gates.

## Troubleshooting

- If Codex does not see the server, rebuild with `npm run build` and restart Codex.
- If new tool arguments do not appear, restart Codex so the MCP schema refreshes.
- If a block is not ready, check evidence extraction, research approval, spec approval, dependencies, and implementation target.
- On Windows, quote paths with spaces.

Example Windows project path:

```text
"C:\Users\<YOU>\New folder (3)\my_project"
```

## Worked Example: MNIST

![MNIST worked example flow](assets/mnist-flow.svg)

This repo includes a complete Python/PyTorch MNIST example in [`mnist_folder`](mnist_folder).

Useful files:

- [`B-001 Data Pipeline and Preprocessing`](mnist_folder/blocks/B-001-data-pipeline-and-preprocessing/block.md)
- [`B-002 CNN Model Training`](mnist_folder/blocks/B-002-cnn-model-training/block.md)
- [`B-003 Evaluation, Inference, and Run Instructions`](mnist_folder/blocks/B-003-evaluation-inference-and-run-instructions/block.md)
- [`mnist_pipeline/data.py`](mnist_folder/mnist_pipeline/data.py)
- [`mnist_pipeline/model.py`](mnist_folder/mnist_pipeline/model.py)
- [`mnist_pipeline/evaluation.py`](mnist_folder/mnist_pipeline/evaluation.py)
- [`mnist_pipeline/RUN_INSTRUCTIONS.md`](mnist_folder/mnist_pipeline/RUN_INSTRUCTIONS.md)

Example prompt shape:

```text
Use deep_learning_auto_research. Start project <REPO_PATH>\mnist_folder from plan <REPO_PATH>\mnist_folder\mnist.md with language Python and framework PyTorch. Propose no more than 3 blocks. Do not write blocks until I approve.
```

Verify the example:

```bash
python -m unittest discover -s mnist_folder\tests -t mnist_folder -p "test_*.py"
npm run verify
```
