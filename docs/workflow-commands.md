# Workflow Commands

The workflow is organized into five user-facing command families. Codex may call lower-level MCP tools internally, but normal users should stay with these five prompts.

| Stage | User-facing tool family | Stops before |
| --- | --- | --- |
| 1. Start Project | `workflow.start_project` | writing block folders |
| 2. Write Blocks | `workflow.write_blocks` | evidence gathering |
| 3. Refine | `workflow.refine` | evidence/spec/code, unless finalizing a reviewed design session |
| 4. Gather Evidence | `workflow.gather_evidence` | research approval/spec/code |
| 5. Implement | `workflow.implement` | nothing after verification |

Lower-level `planner.*` tools and older workflow aliases still exist for compatibility and internal orchestration. The compact workflow should use the five families above.

## 1. Start Project

```text
Use deep_learning_auto_research. Start project <PROJECT_PATH> from plan <PLAN_MARKDOWN_PATH> with language <LANGUAGE> and framework <FRAMEWORK>. Propose no more than <MAX_BLOCKS> blocks. Do not write blocks until I approve.
```

This creates the project, ingests the plan, sets the implementation target, and proposes semantic blocks from the actual plan. It does not write block folders yet.

## 2. Write Blocks

```text
Use deep_learning_auto_research. Write the approved proposed blocks for project <PROJECT_PATH>.
```

This writes the approved decomposition, creates block folders, exports the graph, extracts original-plan acceptance criteria, and immediately adds inline `[n]` checkpoints inside each `block.md`. The criteria are stored in `criteria.md`, coverage history goes into `criteria-diff.md`, and the meaning of each checkpoint is stored in that block's `pins.md`.

The user does not create these pins manually. They are created from the original plan and the approved block content so later discussions can refer to concrete checkpoints like `[1]` or `[2]`.

## 3. Refine

Use this family when you want to discuss or change blocks before evidence/spec/code.

For all written blocks:

```text
Use deep_learning_auto_research. Refine the written blocks in project <PROJECT_PATH> before evidence. Check the original plan, block.md files, and pins.md files, then ask what needs to change. Do not gather evidence, create specs, or implement.
```

For one block:

```text
Use deep_learning_auto_research. Refine block <BLOCK_ID> in project <PROJECT_PATH>. Use the existing [n] pins from block.md and pins.md, compare my requested changes against the block and extracted evidence if present, and keep recording the design discussion until I say we are done. Do not create specs or implement.
```

When the discussion is done:

```text
Use deep_learning_auto_research. Finalize the refinement for block <BLOCK_ID> in project <PROJECT_PATH>. Convert approved decisions into implementation directives, approve evidence if ready, create spec.md, and show it for review. Do not approve spec or implement.
```

This family is where annotations and implementation directives are handled. The user can talk normally or provide an `annotation-B-001.md` style note; Codex should keep adding the relevant context to the design record internally.

## 4. Gather Evidence

```text
Use deep_learning_auto_research. Gather evidence for block <BLOCK_ID> in project <PROJECT_PATH>. Search online and use any user-provided files. Extract only <BLOCK_ID>-specific evidence. Do not approve or implement.
```

Evidence is not limited to papers. It can include papers, official docs, repositories, datasets, benchmarks, model cards, API docs, implementation examples, user files, and local project files.

If evidence creates new checkpoints, the MCP appends them to the same `pins.md` used by the block. It does not create a separate pin system.

## 5. Implement

To create the reviewed spec from approved design/evidence, the spec must map every original-plan acceptance criterion from `criteria.md`:

```text
Use deep_learning_auto_research. Create spec.md for block <BLOCK_ID> in project <PROJECT_PATH> from block.md, pins.md, papers.md, extracted-research.md, approved implementation directives, and the approved implementation target. Do not approve spec or implement.
```

To implement after reviewing the spec:

```text
Use deep_learning_auto_research. Approve spec, implement, record, and verify block <BLOCK_ID> in project <PROJECT_PATH>.
```

This is the only family that writes implementation code. It approves the reviewed spec if needed, prepares strict implementation context, implements only that block, records changed files, requires criteria coverage evidence, runs verification, updates `criteria-diff.md`, and marks the block verified.

Use reimplementation only when you intentionally want to redo a completed block:

```text
Use deep_learning_auto_research. Reimplement, record, and verify block <BLOCK_ID> in project <PROJECT_PATH> with mode reimplement.
```

## Final Code Context

After all blocks are implemented or verified:

```text
Use deep_learning_auto_research. Prepare final code context for project <PROJECT_PATH> in strict mode after all blocks are implemented or verified.
```

