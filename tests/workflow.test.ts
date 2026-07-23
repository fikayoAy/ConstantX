import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("planner MCP server supports the full research-gated block workflow", async () => {
  const projectPath = path.join(".test-output", `workflow-${process.pid}-${Date.now()}`);
  await fs.mkdir(".test-output", { recursive: true });

  const client = new Client({ name: "planner-test-client", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/src/index.js"],
    cwd: process.cwd(),
    stderr: "pipe"
  });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "planner.create_project"));
    assert.ok(tools.tools.some((tool) => tool.name === "planner.set_implementation_target"));
    assert.ok(tools.tools.some((tool) => tool.name === "planner.prepare_implementation_context"));

    const created = await call(client, "planner.create_project", { projectPath });
    assert.equal(created.version, 1);
    assert.equal(created.implementation_target, undefined);

    const target = await call(client, "planner.set_implementation_target", {
      projectPath,
      language: "TypeScript",
      framework: "Node.js"
    });
    assert.deepEqual(target, { language: "TypeScript", framework: "Node.js" });

    const readTarget = await call(client, "planner.get_implementation_target", { projectPath });
    assert.deepEqual(readTarget, target);

    const plan = [
      "# Evidence Mapping System",
      "",
      "## Source Document Intake",
      "Accept markdown project plans and preserve the exact source text that produced each block.",
      "",
      "## Research Evidence Mapping",
      "Attach papers to the specific block they inform and extract only claims relevant to that block.",
      "",
      "## Approved Block Implementation",
      "Prepare implementation context only after the user approves extracted research."
    ].join("\n");

    await call(client, "planner.ingest_plan", {
      projectPath,
      content: plan,
      planFileName: "system-plan.md"
    });

    const proposed = await call(client, "planner.decompose_plan", { projectPath });
    assert.equal(proposed.written, false);
    assert.equal(proposed.blocks.length, 3);
    assert.equal(proposed.blocks[0].title, "Source Document Intake");

    const written = await call(client, "planner.decompose_plan", {
      projectPath,
      write: true,
      blocks: [
        {
          id: "B-001",
          title: "Source Document Intake",
          purpose: "Accept markdown plans and preserve plan text traceability.",
          responsibilities: ["Store the plan", "Reference the source plan lines"],
          implementation_criteria: ["The block package records source plan references."]
        },
        {
          id: "B-002",
          title: "Research Evidence Mapping",
          purpose: "Attach papers to relevant plan blocks and store extracted evidence.",
          depends_on: ["B-001"],
          responsibilities: ["Attach papers", "Prepare research context", "Store extracted research"],
          implementation_criteria: ["Extraction is block-specific and evidence-linked."]
        }
      ]
    });
    assert.equal(written.written, true);
    assert.equal(written.blocks.length, 2);

    const blockedBeforeApproval = await client.callTool({
      name: "planner.prepare_implementation_context",
      arguments: { projectPath, blockId: "B-001" }
    });
    assert.equal("isError" in blockedBeforeApproval ? blockedBeforeApproval.isError : false, true);

    const paper = await call(client, "planner.attach_paper", {
      projectPath,
      blockId: "B-001",
      title: "Traceable Planning Notes",
      citation: "Internal test paper",
      content: "# Traceable Planning Notes\n\nUse stable block ids and explicit source references.",
      notes: "Relevant to source traceability.",
      relevant_sections: ["Stable identifiers", "Source references"]
    });
    assert.equal(paper.id, "P-001");
    assert.deepEqual(paper.attached_to, ["B-001"]);

    const onlineResearch = await call(client, "planner.prepare_online_research", {
      projectPath,
      blockId: "B-001"
    });
    assert.equal(onlineResearch.blockId, "B-001");
    assert.ok(onlineResearch.queries.length > 0);

    const onlinePaper = await call(client, "planner.add_paper_reference", {
      projectPath,
      blockId: "B-001",
      title: "Online Traceability Paper",
      sourceUrl: "https://arxiv.org/abs/0000.00000",
      citation: "Online Author et al., 2026",
      abstract: "A paper about traceable planning systems.",
      notes: "Relevant to online paper reference handling.",
      relevant_sections: ["Traceability"],
      relevanceScore: 0.8
    });
    assert.equal(onlinePaper.id, "P-002");
    assert.equal(onlinePaper.discovery_source, "codex_online");

    const researchContext = await call(client, "planner.prepare_research_context", {
      projectPath,
      blockId: "B-001"
    });
    assert.match(researchContext.block, /Source Document Intake/);
    assert.equal(researchContext.papers.length, 2);
    assert.match(researchContext.paperText[0].content, /stable block ids/i);
    assert.ok(researchContext.onlineResearch.queries.length > 0);

    await call(client, "planner.extract_research", {
      projectPath,
      blockId: "B-001",
      generatedBy: "test",
      extractionMarkdown: [
        "# Extracted Research For B-001 Source Document Intake",
        "",
        "## Relevant Claims",
        "- Stable block ids preserve traceability.",
        "",
        "## Evidence Map",
        "- P-001: Stable identifiers"
      ].join("\n")
    });

    const approved = await call(client, "planner.approve_research", {
      projectPath,
      blockId: "B-001",
      approvedBy: "test-user"
    });
    assert.equal(approved.status, "research_approved");

    const blockedBeforeSpec = await client.callTool({
      name: "planner.prepare_implementation_context",
      arguments: { projectPath, blockId: "B-001" }
    });
    assert.equal("isError" in blockedBeforeSpec ? blockedBeforeSpec.isError : false, true);

    const spec = await call(client, "planner.create_spec", {
      projectPath,
      blockId: "B-001",
      generatedBy: "test",
      specMarkdown: [
        "# Implementation Spec For B-001 Source Document Intake",
        "",
        "## Implementation Objective",
        "Implement traceable source document intake.",
        "",
        "## Verification Plan",
        "Run the MCP workflow test."
      ].join("\n")
    });
    assert.equal(spec.block.status, "spec_created");
    const generatedSpec = await fs.readFile(path.join(projectPath, "blocks", "B-001-source-document-intake", "spec.md"), "utf8");
    assert.match(generatedSpec, /## Implementation Target/);
    assert.match(generatedSpec, /Language: TypeScript/);
    assert.match(generatedSpec, /Framework: Node\.js/);

    const approvedSpec = await call(client, "planner.approve_spec", {
      projectPath,
      blockId: "B-001",
      approvedBy: "test-user"
    });
    assert.equal(approvedSpec.status, "ready_to_implement");

    const ready = await call(client, "planner.get_ready_blocks", { projectPath });
    assert.deepEqual(ready.map((block: { id: string }) => block.id), ["B-001"]);

    const implementationContext = await call(client, "planner.prepare_implementation_context", {
      projectPath,
      blockId: "B-001"
    });
    assert.match(implementationContext.context, /Approved Extracted Research/);
    assert.match(implementationContext.context, /Approved Implementation Spec/);
    assert.match(implementationContext.context, /## Implementation Target/);
    assert.match(implementationContext.context, /Language: TypeScript/);
    assert.match(implementationContext.context, /Stable block ids preserve traceability/);

    const implemented = await call(client, "planner.record_implementation", {
      projectPath,
      blockId: "B-001",
      summary: "Implemented source document intake traceability.",
      changedFiles: ["src/storage.ts"]
    });
    assert.equal(implemented.status, "implemented");

    const blockedAfterImplementation = await client.callTool({
      name: "planner.prepare_implementation_context",
      arguments: { projectPath, blockId: "B-001" }
    });
    assert.equal("isError" in blockedAfterImplementation ? blockedAfterImplementation.isError : false, true);
    assert.match(getText(blockedAfterImplementation), /not ready to implement.*implemented/i);

    const reimplementationContext = await call(client, "planner.prepare_implementation_context", {
      projectPath,
      blockId: "B-001",
      mode: "reimplement"
    });
    assert.equal(reimplementationContext.mode, "reimplement");
    assert.match(reimplementationContext.context, /## Reimplementation Mode/);
    assert.match(reimplementationContext.context, /explicitly requested mode reimplement/);
    assert.match(reimplementationContext.context, /Implemented source document intake traceability/);

    const verified = await call(client, "planner.verify_block", {
      projectPath,
      blockId: "B-001",
      evidence: "End-to-end MCP workflow test passed.",
      verifier: "node:test"
    });
    assert.equal(verified.status, "verified");

    await call(client, "planner.attach_paper", {
      projectPath,
      blockId: "B-002",
      title: "Evidence Mapping Notes",
      content: "# Evidence Mapping Notes\n\nOnly extract claims relevant to the active block."
    });
    await call(client, "planner.extract_research", {
      projectPath,
      blockId: "B-002",
      extractionMarkdown: "# Extracted Research\n\n## Relevant Claims\n- Extraction must be block-specific."
    });
    const approvedDependent = await call(client, "planner.approve_research", {
      projectPath,
      blockId: "B-002"
    });
    assert.equal(approvedDependent.status, "research_approved");
    await call(client, "planner.create_spec", {
      projectPath,
      blockId: "B-002",
      specMarkdown: "# Spec\n\nImplement block-specific extraction storage."
    });
    const approvedDependentSpec = await call(client, "planner.approve_spec", {
      projectPath,
      blockId: "B-002"
    });
    assert.equal(approvedDependentSpec.status, "ready_to_implement");

    const graph = await call(client, "planner.export_graph", { projectPath });
    assert.match(graph.markdown, /B-002 --depends_on--> B-001/);

    await call(client, "planner.record_implementation", {
      projectPath,
      blockId: "B-002",
      summary: "Implemented research evidence mapping.",
      changedFiles: ["src/storage.ts"]
    });
    await call(client, "planner.verify_block", {
      projectPath,
      blockId: "B-002",
      evidence: "Dependent block verification passed."
    });
    const finalCodeContext = await call(client, "planner.prepare_final_code_context", { projectPath });
    assert.equal(finalCodeContext.allImplemented, true);
    assert.match(finalCodeContext.context, /Final Code Synthesis Context/);
  } finally {
    await client.close();
  }
});

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  const result = await client.callTool({ name, arguments: args });
  assert.equal("isError" in result ? result.isError : false, false, getText(result));
  return JSON.parse(getText(result));
}

function getText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const maybeContent = "content" in result ? result.content : undefined;
  assert.ok(Array.isArray(maybeContent));
  const text = maybeContent.find((item: unknown): item is { type: "text"; text: string } => {
    return typeof item === "object" && item !== null && "type" in item && item.type === "text" && "text" in item;
  });
  assert.ok(text);
  return text.text;
}
