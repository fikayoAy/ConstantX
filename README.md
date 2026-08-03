# deep_learning_auto_research

`deep_learning_auto_research` is an opt-in MCP workflow for Codex. It turns a markdown system plan into traceable implementation blocks, gathers block-specific evidence, supports user-guided redesign before specs, and gates code implementation behind approved research, approved specs, and strict implementation context.

Use it from Codex only when your prompt starts like this:

```text
Use deep_learning_auto_research. <workflow action>
```

![deep_learning_auto_research hero](assets/ChatGPT%20Image%20Jul%2023%2C%202026%2C%2001_54_24%20PM.png)

## Documentation

- [Installation](docs/installation.md)
- [Codex Opt-In Setup](docs/codex-opt-in.md)
- [Project Layout](docs/project-layout.md)
- [Workflow Commands](docs/workflow-commands.md)
- [Block Design Sessions](docs/block-design-sessions.md)
- [Rules And Troubleshooting](docs/rules-and-troubleshooting.md)
- [MNIST Worked Example](docs/mnist-example.md)

## What It Does

- Decomposes a markdown plan into semantic implementation blocks from the actual plan, not generic phases.
- Stores each block as markdown artifacts for evidence, pins, design sessions, directives, specs, and implementation records.
- Lets Codex gather broad evidence: papers, official docs, repositories, datasets, benchmarks, model cards, API docs, implementation examples, user files, and local project files.
- Creates internal design pins so redesign discussions stay anchored to the original plan and block evidence.
- Converts approved design decisions into implementation directives and concrete specs before implementation.
- Preserves strict gates so implementation starts only after approved research, approved spec, dependencies, and strict implementation context.

![Research-gated implementation workflow](assets/workflow.svg)

## Quick Start

```bash
npm install
npm run build
```

Add the MCP server to Codex:

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

Then restart Codex.

## Main Prompt Shape

```text
Use deep_learning_auto_research. Start project <PROJECT_PATH> from plan <PLAN_MARKDOWN_PATH> with language <LANGUAGE> and framework <FRAMEWORK>. Propose no more than <MAX_BLOCKS> blocks. Do not write blocks until I approve.
```

Continue with the stage prompts in [Workflow Commands](docs/workflow-commands.md). Use [Block Design Sessions](docs/block-design-sessions.md) when you need to discuss and redesign a block before `spec.md` is finalized.
