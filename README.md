# deep_learning_auto_research

`deep_learning_auto_research` is an opt-in MCP workflow for Codex. It turns a markdown system plan into traceable implementation blocks, connects each block to research evidence, creates concrete specs, and gates implementation behind approved context.

Use it from Codex with prompts that start like this:

```text
Use deep_learning_auto_research. <workflow action>
```

![deep_learning_auto_research hero](assets/ChatGPT%20Image%20Jul%2023%2C%202026%2C%2001_54_24%20PM.png)

## What It Does

- Decomposes a system plan into actual plan-derived implementation blocks.
- Stores each block as markdown: `block.md`, `papers.md`, `extracted-research.md`, `directives.md`, `spec.md`, and `implementation.md`.
- Lets Codex search for papers or use papers you attach.
- Supports source-based annotations and approved implementation directives.
- Requires approved research, approved spec, dependencies, and implementation target before coding.

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
  graph.md
  system-plan.md
```

Blocks are semantic parts of your source plan, not generic phases like foundation, training, or deployment.

## Core Workflow

1. Create a planner project.
2. Ingest the markdown system plan.
3. Decompose the plan into semantic blocks.
4. Review and write approved blocks.
5. Set implementation target: language plus framework.
6. Prepare research for one block.
7. Attach papers or let Codex find primary papers online.
8. Extract block-specific research.
9. Approve extracted research.
10. Add annotations or implementation directives if needed.
11. Create and approve `spec.md`.
12. Prepare strict implementation context.
13. Implement only that block.
14. Record and verify the implementation.
15. Repeat for every block.
16. Prepare final code context after all blocks are implemented or verified.

Strict implementation context is the gate that prevents early implementation.

## Prompt Commands

Replace placeholders like `<PROJECT_PATH>`, `<PLAN_MARKDOWN_PATH>`, `<BLOCK_ID>`, `<LANGUAGE>`, and `<FRAMEWORK>`.

### Project Setup

```text
Use deep_learning_auto_research. Create a planner project at <PROJECT_PATH>.
```

```text
Use deep_learning_auto_research. Ingest <PLAN_MARKDOWN_PATH> into project <PROJECT_PATH> as <PLAN_FILE_NAME>.
```

```text
Use deep_learning_auto_research. Read the plan in project <PROJECT_PATH>. Reason over <PLAN_FILE_NAME> and propose no more than <MAX_BLOCKS> semantic implementation blocks. Show me the proposed blocks before writing them.
```

```text
Use deep_learning_auto_research. Write the approved proposed blocks to project <PROJECT_PATH> by calling planner.decompose_plan with the blocks I approved.
```

```text
Use deep_learning_auto_research. List all blocks in project <PROJECT_PATH>.
```

### Implementation Target

Set this before creating specs or implementing.

```text
Use deep_learning_auto_research. Set implementation target for project <PROJECT_PATH> to language <LANGUAGE> and framework <FRAMEWORK>. Do not implement.
```

```text
Use deep_learning_auto_research. Read the implementation target for project <PROJECT_PATH>.
```

### Research

```text
Use deep_learning_auto_research. Prepare online research context for <BLOCK_ID> in project <PROJECT_PATH>. Search for relevant primary papers, add the useful ones as paper references, then extract only <BLOCK_ID>-specific research. Do not implement yet.
```

```text
Use deep_learning_auto_research. Attach my paper <PAPER_PATH> to <BLOCK_ID> in project <PROJECT_PATH> with title "<PAPER_TITLE>" and citation "<PAPER_CITATION>". Do not implement.
```

```text
Use deep_learning_auto_research. Read block <BLOCK_ID> in project <PROJECT_PATH> so I can review block.md, papers.md, and extracted-research.md. Do not implement.
```

```text
Use deep_learning_auto_research. Approve extracted research for <BLOCK_ID> in project <PROJECT_PATH> with reviewer <REVIEWER_NAME>.
```

### Annotation And Directives

![Annotation and directive loop](assets/redirection_loop.png)

Use annotations for source-based notes that should not change workflow status. Use implementation directives for approved decisions that must shape the spec and implementation.

```text
Use deep_learning_auto_research. Prepare annotation context for <TARGET_FILE> in project <PROJECT_PATH> for block <BLOCK_ID>.

Use this source from <SOURCE_FILE>:
<ANNOTATION_SOURCE_OR_EXCERPT>

Search online if needed. Do not approve, create specs, or implement.
```

```text
Use deep_learning_auto_research. Annotate <TARGET_FILE> in project <PROJECT_PATH> for block <BLOCK_ID>.

Apply this reviewed annotation:
<ANNOTATION>

The annotation is based on <SOURCE_FILE>:
<ANNOTATION_SOURCE_OR_EXCERPT>

Do not approve research, create or approve specs, record implementation, verify, or implement.
```

```text
Use deep_learning_auto_research. Add an approved implementation directive to <BLOCK_ID> in project <PROJECT_PATH>.

Take the <MODEL_OR_EVIDENCE> evidence from extracted-research.md and use it as the <IMPLEMENTATION_ROLE> for <INPUT_OR_PIPELINE_SCOPE>.

Do not implement yet.
```

Example directive:

```text
Use deep_learning_auto_research. Add an approved implementation directive to B-001 in project C:\Users\ayode\MotionIntelligence\full_scene_entity_skill_planner.

Take the SAM 2 evidence from extracted-research.md and use it as the video segmentation and mask propagation model for video inputs.

Do not implement yet.
```

```text
Use deep_learning_auto_research. Read directives for <BLOCK_ID> in project <PROJECT_PATH>. Do not implement.
```

### Spec

```text
Use deep_learning_auto_research. Create spec.md for <BLOCK_ID> in project <PROJECT_PATH>. Do not implement yet.
```

```text
Use deep_learning_auto_research. Read block <BLOCK_ID> in project <PROJECT_PATH> so I can review spec.md. Do not implement.
```

```text
Use deep_learning_auto_research. Approve spec.md for <BLOCK_ID> in project <PROJECT_PATH> with reviewer <REVIEWER_NAME>.
```

### Implementation

```text
Use deep_learning_auto_research. List ready blocks in project <PROJECT_PATH>.
```

```text
Use deep_learning_auto_research. Prepare strict implementation context for <BLOCK_ID> in project <PROJECT_PATH>, then implement only <BLOCK_ID> from the approved spec.
```

Use `mode reimplement` only when you intentionally want to redo an already implemented or verified block:

```text
Use deep_learning_auto_research. Prepare strict implementation context for <BLOCK_ID> in project <PROJECT_PATH> with mode reimplement, then reimplement only <BLOCK_ID> from the approved spec.
```

```text
Use deep_learning_auto_research. Record the implementation for <BLOCK_ID> in project <PROJECT_PATH> with summary "<IMPLEMENTATION_SUMMARY>" and changed files <CHANGED_FILES>.
```

```text
Use deep_learning_auto_research. Verify <BLOCK_ID> in project <PROJECT_PATH> with verifier <VERIFIER_NAME> and evidence "<TEST_OR_BUILD_EVIDENCE>".
```

### Final Code Context

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
- Specs are accepted only after research approval and must be concrete, non-placeholder, traceable, target-specific, directive-aware, and paper/model-aware.
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

### Main Prompts Used

```text
Use deep_learning_auto_research. Create a planner project at "C:\Users\ayode\New folder (3)"
```

```text
Use deep_learning_auto_research. Ingest C:\Users\ayode\New folder (3)\mnist.md into project C:\Users\ayode\New folder (3) as mnist.
```

```text
Use deep_learning_auto_research. Read the plan in project C:\Users\ayode\New folder (3). Reason over mnist.md and propose no more than 3 semantic implementation blocks. Show me the proposed blocks before writing them.
```

```text
Use deep_learning_auto_research. Write the approved proposed blocks to project C:\Users\ayode\New folder (3) by calling planner.decompose_plan with the blocks I approved.
```

```text
Use deep_learning_auto_research. Set implementation target for project C:\Users\ayode\New folder (3) to language Python and framework PyTorch. Do not implement.
```

```text
Use deep_learning_auto_research. Prepare online research context for <BLOCK_ID> in project C:\Users\ayode\New folder (3). Search for relevant primary papers, add the useful ones as paper references, then extract only <BLOCK_ID>-specific research. Do not implement yet.
```

```text
Use deep_learning_auto_research. Approve extracted research for <BLOCK_ID> in project C:\Users\ayode\New folder (3) with reviewer fikayo.
```

```text
Use deep_learning_auto_research. Create spec.md for <BLOCK_ID> in project C:\Users\ayode\New folder (3). Do not implement yet.
```

```text
Use deep_learning_auto_research. Approve spec.md for <BLOCK_ID> in project C:\Users\ayode\New folder (3) with reviewer fikayo.
```

```text
Use deep_learning_auto_research. Prepare strict implementation context for <BLOCK_ID> in project C:\Users\ayode\New folder (3) with mode reimplement, then reimplement only <BLOCK_ID> from the approved spec.
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