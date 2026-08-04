# Rules And Troubleshooting

## Rules

- The workflow is opt-in and should only run when you explicitly say `Use deep_learning_auto_research`.
- Normal use has five command families: Start Project, Write Blocks, Refine, Gather Evidence, and Implement.
- `<PROJECT_PATH>` is a directory, not the plan file path.
- Set language and framework before specs or implementation.
- `workflow.write_blocks` creates inline `[n]` checkpoints in `block.md` and records their meaning in `pins.md`.
- Users do not manage pins manually; Codex uses them to stay anchored during refinement, evidence extraction, spec generation, and implementation.
- Evidence extraction must be block-specific and is not limited to papers.
- A refinement/annotation/design note does not advance workflow status by itself.
- A directive is an approved implementation decision and must appear in `spec.md` and strict implementation context.
- Specs must be concrete, non-placeholder, target-specific, directive-aware, evidence/model-aware, and traceable to block sources and required `[n]` pins.
- Implementation starts only after strict implementation context succeeds.
- Dependencies must be implemented or verified before dependent blocks are implemented.
- `mode reimplement` allows redoing a completed block, but it does not bypass strict gates.

## Troubleshooting

- If Codex does not see the server, rebuild with `npm run build` and restart Codex.
- If new tool arguments do not appear, restart Codex so the MCP schema refreshes.
- If a block is not ready, check evidence extraction, research approval, spec approval, dependencies, and implementation target.
- If a spec is rejected, check that it cites the relevant `[n]` pins, attached evidence, approved directives, implementation target, artifact changes/removals, non-goals, acceptance criteria, and verification plan.
- On Windows, quote paths with spaces.

Example Windows project path:

```text
"C:\Users\<YOU>\New folder (3)\my_project"
```
