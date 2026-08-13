# Installation

Prerequisites:

- Node.js
- npm
- Codex with MCP server support

Build the server:

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
    "ConstantX": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH_TO_REPO>/dist/src/index.js"]
    }
  }
}
```

Restart Codex after changing MCP config or rebuilding the server.
