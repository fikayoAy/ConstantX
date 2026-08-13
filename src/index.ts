#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPlannerServer } from "./server.js";

async function main(): Promise<void> {
  const server = createPlannerServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ConstantX running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in ConstantX:", error);
  process.exit(1);
});
