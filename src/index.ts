#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPlannerServer } from "./server.js";

async function main(): Promise<void> {
  const server = createPlannerServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("deep_learning_auto_research running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in deep_learning_auto_research:", error);
  process.exit(1);
});
