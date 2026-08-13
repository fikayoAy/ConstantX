# Codex Opt-In Setup

Add this to your global `AGENTS.md` so the tool is used only when requested:

```md
[Tools]

ConstantX is opt-in only.

Use the ConstantX MCP server only when I explicitly ask with a prompt that starts with or clearly includes "Use ConstantX" or "Use the ConstantX MCP workflow".

Do not use ConstantX automatically for normal coding, debugging, editing, explanation, refactoring, terminal, or research tasks.

When ConstantX is invoked, follow the requested MCP stage exactly and do not advance to another stage unless I ask.
```
