# deep_learning_auto_research

`deep_learning_auto_research` is an opt-in MCP workflow for Codex. It turns a markdown system plan into traceable implementation blocks, connects each block to research evidence, creates concrete specs, and gates implementation behind approved context.

Use it from Codex with prompts that start like this:

```text
Use deep_learning_auto_research. <workflow action>
```

![deep_learning_auto_research hero](assets/ChatGPT%20Image%20Jul%2023%2C%202026%2C%2001_54_24%20PM.png)

## What It Does

- Decomposes a system plan into actual plan-derived implementation blocks.
- Stores each block as markdown: `block.md`, `papers.md`/evidence references, `extracted-research.md`, `directives.md`, `spec.md`, and `implementation.md`.
- Lets Codex gather broad evidence: papers, official docs, repositories, datasets, benchmarks, model cards, implementation references, user files, and local project files.
- Supports source-based annotations and approved implementation directives.
- Exposes five consolidated `workflow.*` commands while preserving strict internal approval gates before coding.

![Research-gated implementation workflow](assets/workflow.svg)

## Installation

Prerequisites:

- Node.js
- npm
- Codex with MCP server support

Build the MCP server:

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

## Codex Instructions

Add this opt-in rule to your global `AGENTS.md`:

```md
[Tools]

deep_learning_auto_research is opt-in only.

Use the deep_learning_auto_research MCP server only when I explicitly ask with a prompt that starts with or clearly includes "Use deep_learning_auto_research" or "Use the deep_learning_auto_research MCP workflow".

Do not use deep_learning_auto_research automatically for normal coding, debugging, editing, explanation, refactoring, terminal, or research tasks.

When deep_learning_auto_research is invoked, follow the requested MCP stage exactly and do not advance to another stage unless I ask.
```

## Project Files

A planner project is stored inside your selected `<PROJECT_PATH>`:

```text
<PROJECT_PATH>/
  .planner/
    state.json
    graph.json
    audit-log.jsonl
  blocks/
    B-001-.../
      block.md
      papers.md
      extracted-research.md
      directives.md
      spec.md
      implementation.md
  papers/
    P-001-...md          # evidence/reference records, not only papers
  graph.md
  system-plan.md
```

Blocks are semantic parts of your source plan, not generic phases like foundation, training, or deployment.

## Core Workflow

The normal workflow is now five user-facing commands. Each command maps to strict internal MCP stages and stops at the right review gate.

1. Start the project.
2. Approve and write the plan blocks.
3. Gather block evidence from online sources and user-provided files.
4. Prepare the block design and spec.
5. Implement and verify the block.

Strict implementation context remains the gate that prevents early implementation. The lower-level `planner.*` tools still exist for advanced/manual control, but normal usage should go through the five consolidated `workflow.*` tools.

## Prompt Commands

Replace placeholders like `<PROJECT_PATH>`, `<PLAN_MARKDOWN_PATH>`, `<BLOCK_ID>`, `<LANGUAGE>`, `<FRAMEWORK>`, and `<MAX_BLOCKS>`.

### Consolidated MCP Tools

| User stage | MCP tool |
| --- | --- |
| Start project | `workflow.start_project` |
| Approve plan blocks | `workflow.approve_plan_blocks` |
| Gather evidence | `workflow.gather_evidence` |
| Prepare block design | `workflow.prepare_block_design` |
| Implement and verify block | `workflow.implement_and_verify_block` |

### 1. Start Project

```text
Use deep_learning_auto_research. Start project <PROJECT_PATH> from plan <PLAN_MARKDOWN_PATH> with language <LANGUAGE> and framework <FRAMEWORK>. Propose no more than <MAX_BLOCKS> blocks. Do not write blocks until I approve.
```

This creates the project, ingests the plan, sets the implementation target, and proposes semantic blocks. It stops before writing block folders.

### 2. Approve Plan Blocks

```text
Use deep_learning_auto_research. Approve and write the proposed blocks for project <PROJECT_PATH>.
```

This writes the approved block decomposition, creates block folders, and exports the graph. It stops before evidence gathering.

### 3. Gather Evidence

```text
Use deep_learning_auto_research. Gather evidence for block <BLOCK_ID> in project <PROJECT_PATH>. Search online and use any user-provided files. Extract only <BLOCK_ID>-specific evidence. Do not approve or implement.
```

Supported evidence types include papers, official docs, repositories, datasets, benchmarks, model cards, technical reports, API docs, implementation examples, user-uploaded files, and local project files.

This stage prepares online search context, lets Codex attach useful references/files into the evidence store, writes `extracted-research.md`, and stops before approval.

### 4. Prepare Block Design

```text
Use deep_learning_auto_research. Prepare block design for <BLOCK_ID> in project <PROJECT_PATH>. Include any annotations or implementation directives I provide, approve research, create spec.md, and show it for review. Do not approve spec or implement.
```

Use annotations for source-based notes that do not change workflow status. Use implementation directives for approved decisions that must shape `spec.md` and implementation.

Example directive:

```text
Use deep_learning_auto_research. Prepare block design for B-001 in project C:\Users\ayode\MotionIntelligence\full_scene_entity_skill_planner.

Add this approved implementation directive:
Take the SAM 2 evidence from extracted-research.md and use it as the video segmentation and mask propagation model for video inputs.

Approve research, create spec.md, and show it for review. Do not approve spec or implement.
```

![Annotation and directive loop](assets/redirection_loop.png)

### 5. Implement And Verify Block

```text
Use deep_learning_auto_research. Approve spec, implement, record, and verify block <BLOCK_ID> in project <PROJECT_PATH>.
```

This is the only consolidated command that writes implementation code. Internally it approves the reviewed spec if needed, prepares strict implementation context, lets Codex implement only that block, records changed files, runs verification, and marks the block verified.

Use reimplementation only when you intentionally want to redo an already implemented or verified block:

```text
Use deep_learning_auto_research. Reimplement, record, and verify block <BLOCK_ID> in project <PROJECT_PATH>.
```

### Final Code Context

After all blocks are implemented or verified:

```text
Use deep_learning_auto_research. Prepare final code context for project <PROJECT_PATH> in strict mode after all blocks are implemented or verified.
```

## Rules
- The workflow is opt-in and should only run when you explicitly say `Use deep_learning_auto_research`.
- The project path must be a directory, not the path to the plan file.
- Set implementation target before specs or implementation.
- Research extraction must be block-specific.
- An annotation adds a traceable note and does not advance workflow status.
- A directive is an approved implementation decision and must be reflected in the spec and implementation context.
- Specs are accepted only after evidence approval and must be concrete, non-placeholder, traceable, target-specific, directive-aware, and evidence/model-aware.
- Implementation starts only after strict implementation context succeeds.
- Dependencies must be implemented or verified before dependent blocks are implemented.
- `mode reimplement` allows redoing a completed block, but it does not bypass strict gates.

## Troubleshooting

- If Codex does not see the server, rebuild with `npm run build` and restart Codex.
- If new tool arguments do not appear, restart Codex so the MCP schema refreshes.
- If a block is not ready, check research approval, spec approval, dependencies, and implementation target.
- On Windows, quote paths with spaces.

Example Windows project path:

```text
"C:\Users\<YOU>\New folder (3)\my_project"
```

## Worked Example: MNIST

![MNIST worked example flow](assets/mnist-flow.svg)

This repo includes a complete Python/PyTorch MNIST example in [`mnist_folder`](mnist_folder).

### Output Blocks

- [`B-001 Data Pipeline and Preprocessing`](mnist_folder/blocks/B-001-data-pipeline-and-preprocessing/block.md)
- [`B-002 CNN Model Training`](mnist_folder/blocks/B-002-cnn-model-training/block.md)
- [`B-003 Evaluation, Inference, and Run Instructions`](mnist_folder/blocks/B-003-evaluation-inference-and-run-instructions/block.md)

### Research And Specs

- [`B-001 papers.md`](mnist_folder/blocks/B-001-data-pipeline-and-preprocessing/papers.md)
- [`B-001 extracted-research.md`](mnist_folder/blocks/B-001-data-pipeline-and-preprocessing/extracted-research.md)
- [`B-001 spec.md`](mnist_folder/blocks/B-001-data-pipeline-and-preprocessing/spec.md)
- [`B-002 papers.md`](mnist_folder/blocks/B-002-cnn-model-training/papers.md)
- [`B-002 extracted-research.md`](mnist_folder/blocks/B-002-cnn-model-training/extracted-research.md)
- [`B-002 spec.md`](mnist_folder/blocks/B-002-cnn-model-training/spec.md)
- [`B-003 papers.md`](mnist_folder/blocks/B-003-evaluation-inference-and-run-instructions/papers.md)
- [`B-003 extracted-research.md`](mnist_folder/blocks/B-003-evaluation-inference-and-run-instructions/extracted-research.md)
- [`B-003 spec.md`](mnist_folder/blocks/B-003-evaluation-inference-and-run-instructions/spec.md)

### Implementation Files

- [`mnist_pipeline/data.py`](mnist_folder/mnist_pipeline/data.py)
- [`mnist_pipeline/model.py`](mnist_folder/mnist_pipeline/model.py)
- [`mnist_pipeline/evaluation.py`](mnist_folder/mnist_pipeline/evaluation.py)
- [`mnist_pipeline/RUN_INSTRUCTIONS.md`](mnist_folder/mnist_pipeline/RUN_INSTRUCTIONS.md)
- [`tests/test_mnist_pipeline.py`](mnist_folder/tests/test_mnist_pipeline.py)
- [`tests/test_mnist_model.py`](mnist_folder/tests/test_mnist_model.py)
- [`tests/test_mnist_evaluation.py`](mnist_folder/tests/test_mnist_evaluation.py)

### Five-Command Prompt Shape

```text
Use deep_learning_auto_research. Start project C:\Users\ayode\New folder (3) from plan C:\Users\ayode\New folder (3)\mnist.md with language Python and framework PyTorch. Propose no more than 3 blocks. Do not write blocks until I approve.
```

```text
Use deep_learning_auto_research. Approve and write the proposed blocks for project C:\Users\ayode\New folder (3).
```

```text
Use deep_learning_auto_research. Gather evidence for block <BLOCK_ID> in project C:\Users\ayode\New folder (3). Search online and use any user-provided files. Extract only <BLOCK_ID>-specific evidence. Do not approve or implement.
```

```text
Use deep_learning_auto_research. Prepare block design for <BLOCK_ID> in project C:\Users\ayode\New folder (3). Include any annotations or implementation directives I provide, approve research, create spec.md, and show it for review. Do not approve spec or implement.
```

```text
Use deep_learning_auto_research. Approve spec, implement, record, and verify block <BLOCK_ID> in project C:\Users\ayode\New folder (3).
```

After moving the finished example, use this project path for future MCP prompts:

```text
<REPO_PATH>\mnist_folder
```

Verify the example:

```bash
python -m unittest discover -s mnist_folder\tests -t mnist_folder -p "test_*.py"
npm run build
npm test
```