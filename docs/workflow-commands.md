# Workflow Commands

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

See [Block Design Sessions](block-design-sessions.md) for the full redesign loop.

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
