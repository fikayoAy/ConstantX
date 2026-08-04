# Project Layout

A planner project is stored inside your chosen `<PROJECT_PATH>`:

```text
<PROJECT_PATH>/
  .planner/
    state.json
    graph.json
    audit-log.jsonl
  blocks/
    B-001-.../
      block.md                    # readable block with inline [n] checkpoints
      pins.md                     # meaning/source of each [n] checkpoint
      papers.md                   # evidence references, not only papers
      extracted-research.md
      design-session.md           # refinement conversation state
      annotation-B-001.md         # user redesign notes captured by Codex
      directives.md               # approved implementation decisions
      spec.md
      implementation.md
  papers/
    P-001-...md
  block-refinement.md             # optional all-block refinement notes
  graph.md
  system-plan.md
```

Blocks are semantic parts of your source plan. They should not be generic phases like foundation, training, evaluation, or deployment unless the original plan actually defines those as real implementation units.

`block.md` should not contain separate source-pin or evidence-pin sections. It only uses inline labels like `[1]`, while `pins.md` stores the detailed checkpoint metadata.
