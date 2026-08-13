# Rules And Troubleshooting

## Rules

- The workflow is opt-in and should only run when you explicitly say `Use ConstantX`.
- Normal use has five command families: Start Project, Write Blocks, Refine, Gather Evidence, and Implement.
- `<PROJECT_PATH>` is a directory, not the plan file path.
- Set language and framework before specs or implementation.
- `workflow.write_blocks` creates original-plan acceptance criteria, inline `[n]` checkpoints in `block.md`, `criteria.md`, `criteria-diff.md`, and records checkpoint meaning in `pins.md`.
- Users do not manage pins manually; Codex uses them to stay anchored during refinement, evidence extraction, spec generation, and implementation.
- Evidence extraction must be block-specific and is not limited to papers.
- `workflow.refine` with a block id automatically creates or updates `annotation-<BLOCK_ID>.md` and `design-session.md`, but a refinement/annotation/design note does not advance workflow status by itself.
- A directive is an approved implementation decision and must appear in `spec.md` and strict implementation context.
- Specs must be concrete, non-placeholder, non-minimal, target-specific, directive-aware, evidence/model-aware, and traceable to block sources, required `[n]` pins, and every acceptance criterion in `criteria.md`.
- Implementation starts only after strict implementation context succeeds, and implementation/verification records must include criteria coverage evidence. ConstantX rejects records that claim stub, placeholder, toy, demo-only, minimal, superficial, TODO-driven, future-work, or partial output as completed implementation. Implementation records must cite approved directives, paper/model fit items, and any exact artifacts declared with backticks in the spec; verification records must cite every command from the spec verification plan.
- Dependencies must be implemented or verified before dependent blocks are implemented.
- `mode reimplement` allows redoing a completed block, but it does not bypass strict gates.

## Troubleshooting

- If Codex does not see the server, rebuild with `npm run build` and restart Codex.
- If new tool arguments do not appear, restart Codex so the MCP schema refreshes.
- If a block is not ready, check evidence extraction, research approval, spec approval, dependencies, and implementation target.
- If a spec is rejected, check that it cites finalized design-session `[n]` pins when present, attached evidence, approved directives, implementation target, artifact changes/removals, non-goals, every `AC-*` criterion, verification plan, and the required Non-Minimal Implementation Requirement section.
- On Windows, quote paths with spaces.

Example Windows project path:

```text
"C:\Users\<YOU>\New folder (3)\my_project"
```

