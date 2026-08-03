# Rules And Troubleshooting

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
