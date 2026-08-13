# Block Design Sessions

Design sessions are now part of the `workflow.refine` command family. They let the user redesign a block before `spec.md` is generated without manually managing pins, stages, or repeated annotation commands.

## Pins Already Exist

Initial `[n]` checkpoints are created when `workflow.write_blocks` writes each block. The readable `block.md` contains labels like `[1]`; `pins.md` stores what each label means and where it came from in the original plan or block content.

A design session reuses those existing pins. If extracted evidence, directives, or an existing spec add new implementation-relevant checkpoints, the MCP appends more `[n]` entries to the same `pins.md` file.

## Start Refinement

```text
Use ConstantX. Refine block <BLOCK_ID> in project <PROJECT_PATH>. Use the existing [n] pins from block.md and pins.md, compare my requested changes against the block and extracted evidence if present, and keep recording the design discussion until I say we are done. Do not create specs or implement.
```

During the discussion, you can speak normally. Codex should compare your requested changes against the pins, block scope, extracted evidence, existing directives, and the original plan, then internally update `annotation-<BLOCK_ID>.md` and `design-session.md`.

You do not need to manage pin ids or send repeated annotation commands.

## Finalize Refinement

```text
Use ConstantX. Finalize the refinement for block <BLOCK_ID> in project <PROJECT_PATH>. Convert approved decisions into implementation directives, approve evidence if ready, create spec.md, and show it for review. Do not approve spec or implement.
```

The generated `spec.md` must cite the relevant `[n]` checkpoints, approved directives, implementation target, evidence/model fit, exact files/artifacts to create or modify, artifacts to remove or replace, non-goals, acceptance criteria, verification plan, and traceability.

![Annotation and directive loop](../assets/redirection_loop.png)
