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
    assert.ok(tools.tools.some((tool) => tool.name === "planner.prepare_annotation_context"));
    assert.ok(tools.tools.some((tool) => tool.name === "planner.annotate_target_file"));
    assert.ok(tools.tools.some((tool) => tool.name === "planner.add_directive"));
    assert.ok(tools.tools.some((tool) => tool.name === "planner.read_directives"));

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
    const b001Block = written.blocks.find((block: { id: string }) => block.id === "B-001");
    assert.ok(b001Block);
    const b001Dir = b001Block.dir;

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

    const annotationTarget = path.join(b001Dir, "extracted-research.md");
    const annotationSource = "Stable block ids preserve traceability and should be retained as source evidence when appending scene discovery research notes.";
    const annotationContext = await call(client, "planner.prepare_annotation_context", {
      projectPath,
      blockId: "B-001",
      targetFile: annotationTarget,
      sourceFile: "extracted-research.md",
      annotationSource,
      onlineResearch: true
    });
    assert.equal(annotationContext.block.id, "B-001");
    assert.equal(annotationContext.target.kind, "extracted_research");
    assert.match(annotationContext.targetContent, /Stable block ids preserve traceability/);
    assert.equal(annotationContext.onlineResearch.sourceFile, "extracted-research.md");
    assert.match(annotationContext.onlineResearch.annotationSource, /Stable block ids/);
    assert.ok(annotationContext.onlineResearch.queries.length > 0);
    assert.match(annotationContext.constraints.join("\n"), /Do not approve research/i);

    const annotated = await call(client, "planner.annotate_target_file", {
      projectPath,
      blockId: "B-001",
      targetFile: annotationTarget,
      sourceFile: "extracted-research.md",
      annotationSource,
      annotationMarkdown: concreteAnnotation("Stable block ids preserve traceability"),
      annotatedBy: "node:test",
      onlineResearchUsed: true,
      sourceUrls: ["https://arxiv.org/abs/0000.00000"]
    });
    assert.equal(annotated.statusUnchanged, "research_extracted");
    assert.equal(annotated.target.kind, "extracted_research");
    assert.equal(annotated.sourceFile, "extracted-research.md");
    assert.ok(annotated.bytesAppended > 0);
    const annotatedResearch = await fs.readFile(path.join(projectPath, annotationTarget), "utf8");
    assert.match(annotatedResearch, /## Annotation: Stable block ids preserve traceability/);
    assert.match(annotatedResearch, /Annotation source file: extracted-research\.md/);
    assert.match(annotatedResearch, /Annotation source excerpt:/);
    assert.match(annotatedResearch, /Online research used: yes/);
    assert.match(annotatedResearch, /Implementation relevance/i);

    const stillResearchExtracted = await call(client, "planner.read_block", {
      projectPath,
      blockId: "B-001"
    });
    assert.equal(stillResearchExtracted.record.status, "research_extracted");

    const badAnnotation = await client.callTool({
      name: "planner.annotate_target_file",
      arguments: {
        projectPath,
        blockId: "B-001",
        targetFile: annotationTarget,
        sourceFile: "extracted-research.md",
        annotationSource,
        annotationMarkdown: "### Sources\n- TBD"
      }
    });
    assert.equal("isError" in badAnnotation ? badAnnotation.isError : false, true);
    assert.match(getText(badAnnotation), /placeholder|not concrete/i);

    const approved = await call(client, "planner.approve_research", {
      projectPath,
      blockId: "B-001",
      approvedBy: "test-user"
    });
    assert.equal(approved.status, "research_approved");

    const directive = await call(client, "planner.add_directive", {
      projectPath,
      blockId: "B-001",
      title: "Use traceability evidence for source intake behavior",
      instruction: "Take the Traceable Planning Notes evidence from extracted-research.md and use it as the required source-reference preservation behavior for markdown plan inputs.",
      inferredImplementation: "The implementation direction is that B-001 must treat the Traceable Planning Notes evidence as the selected behavior for preserving stable block ids and exact source references during markdown source intake. The next spec must cite D-001, describe how this changes source intake behavior, preserve provenance for the directive, and state that this directive must not implement unrelated blocks or final code before strict implementation context.",
      sourceFile: "extracted-research.md",
      sourceEvidence: "P-001 Stable identifiers",
      approvedBy: "test-user"
    });
    assert.equal(directive.directive.id, "D-001");
    assert.equal(directive.block.status, "research_approved");
    assert.equal(directive.specInvalidated, false);

    const readDirectives = await call(client, "planner.read_directives", {
      projectPath,
      blockId: "B-001"
    });
    assert.match(readDirectives.markdown, /D-001/);
    assert.match(readDirectives.markdown, /Traceable Planning Notes/);

    const blockedBeforeSpec = await client.callTool({
      name: "planner.prepare_implementation_context",
      arguments: { projectPath, blockId: "B-001" }
    });
    assert.equal("isError" in blockedBeforeSpec ? blockedBeforeSpec.isError : false, true);

    const defaultSpecAttempt = await client.callTool({
      name: "planner.create_spec",
      arguments: { projectPath, blockId: "B-001" }
    });
    assert.equal("isError" in defaultSpecAttempt ? defaultSpecAttempt.isError : false, true);
    assert.match(getText(defaultSpecAttempt), /requires concrete specMarkdown/i);

    const broadResearchOnlySpecAttempt = await client.callTool({
      name: "planner.create_spec",
      arguments: {
        projectPath,
        blockId: "B-001",
        specMarkdown: concreteSpecWithoutPaperModelFit(
          "B-001",
          "Source Document Intake",
          "Implement traceable source document intake for markdown plans and preserve exact source references for downstream block packages."
        )
      }
    });
    assert.equal("isError" in broadResearchOnlySpecAttempt ? broadResearchOnlySpecAttempt.isError : false, true);
    assert.match(getText(broadResearchOnlySpecAttempt), /paper model fit/i);

    const directiveIgnoredSpecAttempt = await client.callTool({
      name: "planner.create_spec",
      arguments: {
        projectPath,
        blockId: "B-001",
        specMarkdown: concreteSpec(
          "B-001",
          "Source Document Intake",
          "Implement traceable source document intake for markdown plans and preserve exact source references for downstream block packages."
        )
      }
    });
    assert.equal("isError" in directiveIgnoredSpecAttempt ? directiveIgnoredSpecAttempt.isError : false, true);
    assert.match(getText(directiveIgnoredSpecAttempt), /directive/i);

    const spec = await call(client, "planner.create_spec", {
      projectPath,
      blockId: "B-001",
      generatedBy: "test",
      specMarkdown: concreteSpec(
        "B-001",
        "Source Document Intake",
        "Implement traceable source document intake for markdown plans and preserve exact source references for downstream block packages.",
        ["P-001", "P-002"],
        ["D-001"]
      )
    });
    assert.equal(spec.block.status, "spec_created");
    const generatedSpec = await fs.readFile(path.join(projectPath, b001Dir, "spec.md"), "utf8");
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
    assert.match(implementationContext.context, /Approved Implementation Directives/);
    assert.match(implementationContext.context, /D-001/);

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
      specMarkdown: concreteSpec(
        "B-002",
        "Research Evidence Mapping",
        "Implement block-specific research evidence mapping so papers and extracted claims stay attached to the exact active block.",
        ["P-003"]
      )
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


test("consolidated workflow tools support the five-command path", async () => {
  const projectPath = path.join(".test-output", `workflow-five-${process.pid}-${Date.now()}`);
  await fs.mkdir(".test-output", { recursive: true });

  const client = new Client({ name: "planner-five-command-test-client", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/src/index.js"],
    cwd: process.cwd(),
    stderr: "pipe"
  });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    for (const toolName of [
      "workflow.start_project",
      "workflow.approve_plan_blocks",
      "workflow.gather_evidence",
      "workflow.prepare_block_design",
      "workflow.start_block_design_session",
      "workflow.record_block_design_turn",
      "workflow.finalize_block_design_session",
      "workflow.implement_and_verify_block"
    ]) {
      assert.ok(tools.tools.some((tool) => tool.name === toolName), `${toolName} should be registered`);
    }

    const plan = [
      "# Compact Evidence System",
      "",
      "## Intake",
      "Read user plans and preserve exact source references.",
      "",
      "## Evidence",
      "Gather broad implementation evidence from papers, repositories, official docs, datasets, and user files."
    ].join("\n");

    const started = await call(client, "workflow.start_project", {
      projectPath,
      content: plan,
      planFileName: "system-plan.md",
      language: "Python",
      framework: "PyTorch",
      maxBlocks: 2
    });
    assert.deepEqual(started.implementationTarget, { language: "Python", framework: "PyTorch" });
    assert.equal(started.proposedBlocks.length, 2);
    assert.match(started.nextActions.join("\n"), /Review the proposed blocks/);

    const approvedBlocks = await call(client, "workflow.approve_plan_blocks", {
      projectPath,
      blocks: [
        {
          id: "B-001",
          title: "Intake",
          purpose: "Read user plans and preserve exact source references.",
          responsibilities: ["Store plan text", "Keep source references"],
          implementation_criteria: ["Source references are deterministic."]
        }
      ]
    });
    assert.equal(approvedBlocks.written, true);
    assert.equal(approvedBlocks.blocks.length, 1);

    const evidencePlan = await call(client, "workflow.gather_evidence", {
      projectPath,
      blockId: "B-001"
    });
    assert.ok(evidencePlan.evidenceTypes.includes("repository"));
    assert.ok(evidencePlan.onlineResearch.queries.length > 0);
    assert.match(evidencePlan.nextActions.join("\n"), /search online/i);

    const gathered = await call(client, "workflow.gather_evidence", {
      projectPath,
      blockId: "B-001",
      references: [
        {
          title: "Example Intake Repository",
          sourceUrl: "https://github.com/example/intake",
          evidenceType: "repository",
          notes: "Repository evidence for source intake behavior.",
          relevant_sections: ["README", "source reference handling"]
        }
      ],
      extractionMarkdown: [
        "# Extracted Research For B-001 Intake",
        "",
        "## Relevant Claims",
        "- Repository evidence shows source references should be explicit and deterministic.",
        "",
        "## Evidence Map",
        "- P-001: Example Intake Repository maps to source-reference behavior."
      ].join("\n"),
      generatedBy: "node:test"
    });
    assert.equal(gathered.attachedEvidence[0].evidence_type, "repository");
    assert.equal(gathered.extraction.block.status, "research_extracted");

    const designed = await call(client, "workflow.prepare_block_design", {
      projectPath,
      blockId: "B-001",
      approvedBy: "node:test",
      specMarkdown: concreteSpec(
        "B-001",
        "Intake",
        "Implement deterministic source intake for user plans and preserve exact source references for downstream block packages.",
        ["P-001"]
      ),
      generatedBy: "node:test"
    });
    assert.equal(designed.block.status, "spec_created");
    assert.match(designed.blockPackage.spec, /Implementation Spec For B-001/);
    assert.match(designed.nextActions.join("\n"), /Review spec/);

    const implementationGate = await call(client, "workflow.implement_and_verify_block", {
      projectPath,
      blockId: "B-001",
      approvedBy: "node:test"
    });
    assert.equal(implementationGate.approvedSpec.status, "ready_to_implement");
    assert.match(implementationGate.implementationContext.context, /Implementation Context For B-001/);
    assert.match(implementationGate.nextActions.join("\n"), /Codex must implement only this block/);

    const verified = await call(client, "workflow.implement_and_verify_block", {
      projectPath,
      blockId: "B-001",
      implementationSummary: "Implemented deterministic source intake.",
      changedFiles: ["src/intake.py"],
      verificationEvidence: "Unit tests passed for deterministic source intake.",
      verifier: "node:test"
    });
    assert.equal(verified.implementation.status, "implemented");
    assert.equal(verified.verification.status, "verified");
  } finally {
    await client.close();
  }
});

test("block design sessions generate pins, record decisions, and finalize into directives plus spec", async () => {
  const projectPath = path.join(".test-output", `workflow-design-session-${process.pid}-${Date.now()}`);
  await fs.mkdir(".test-output", { recursive: true });

  const client = new Client({ name: "planner-design-session-test-client", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/src/index.js"],
    cwd: process.cwd(),
    stderr: "pipe"
  });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    for (const toolName of [
      "workflow.start_block_design_session",
      "workflow.record_block_design_turn",
      "workflow.finalize_block_design_session"
    ]) {
      assert.ok(tools.tools.some((tool) => tool.name === toolName), `${toolName} should be registered`);
    }

    await call(client, "workflow.start_project", {
      projectPath,
      content: [
        "# Design Anchored Pipeline",
        "",
        "## Intake",
        "Read plans and keep the exact source evidence pinned while users redesign the block before spec generation."
      ].join("\n"),
      planFileName: "system-plan.md",
      language: "Python",
      framework: "PyTorch",
      maxBlocks: 1
    });

    const blocks = await call(client, "workflow.approve_plan_blocks", {
      projectPath,
      blocks: [
        {
          id: "B-001",
          title: "Intake",
          purpose: "Read plans and keep source evidence pinned during redesign.",
          responsibilities: ["Store plan text", "Track redesign checkpoints"],
          implementation_criteria: ["Spec generation cites internal pins when finalized."]
        }
      ]
    });
    const blockDir = blocks.blocks[0].dir;

    await call(client, "workflow.gather_evidence", {
      projectPath,
      blockId: "B-001",
      references: [
        {
          title: "Pinned Design Evidence",
          sourceUrl: "https://github.com/example/pinned-design",
          evidenceType: "repository",
          notes: "Repository evidence for checkpointed design sessions.",
          relevant_sections: ["Design checkpoints", "Spec traceability"]
        }
      ],
      extractionMarkdown: [
        "# Extracted Research For B-001 Intake",
        "",
        "## Relevant Claims",
        "- Checkpointed design decisions prevent block drift during spec generation.",
        "",
        "## Evidence Map",
        "- P-001: Pinned Design Evidence maps to design-session traceability."
      ].join("\n"),
      generatedBy: "node:test"
    });

    const session = await call(client, "workflow.start_block_design_session", {
      projectPath,
      blockId: "B-001",
      focus: "Convert user redesign notes into directives before spec generation."
    });
    assert.equal(session.session.status, "active");
    assert.ok(session.pins.length >= 2);
    assert.match(session.context, /Internal Pins/);
    assert.match(session.files.annotation, /annotation-B-001\.md/);

    const approvedPinId = session.pins[0].id;
    const turn = await call(client, "workflow.record_block_design_turn", {
      projectPath,
      blockId: "B-001",
      userNote: "Use the pinned design-session evidence to force spec generation to cite the original plan checkpoint and prevent generic implementation drift.",
      relatedPinIds: [approvedPinId],
      status: "approved",
      questions: []
    });
    assert.equal(turn.turn.status, "approved");
    assert.deepEqual(turn.turn.related_pin_ids, [approvedPinId]);

    const finalized = await call(client, "workflow.finalize_block_design_session", {
      projectPath,
      blockId: "B-001",
      approvedBy: "node:test",
      directives: [
        {
          title: "Use pinned design decisions for spec traceability",
          instruction: "Take the approved design-session evidence from annotation-B-001.md and use it to require spec generation to cite the original plan checkpoint for B-001 before implementation.",
          inferredImplementation: "The implementation direction is that B-001 spec generation must treat the finalized design-session pin as a required traceability checkpoint. The spec must cite the pin id, preserve original plan grounding, state implementation effect, and prevent generic drift or unrelated block implementation before strict implementation context.",
          sourceFile: "annotation-B-001.md",
          sourceEvidence: approvedPinId,
          approvedBy: "node:test"
        }
      ],
      specMarkdown: concreteSpecWithDesignPins(
        "B-001",
        "Intake",
        "Implement checkpointed design-session persistence for source intake so approved user redesign decisions become explicit spec requirements before code implementation.",
        ["P-001"],
        ["D-001"],
        [approvedPinId]
      ),
      generatedBy: "node:test"
    });
    assert.equal(finalized.session.status, "finalized");
    assert.equal(finalized.directives.length, 1);
    assert.equal(finalized.spec.block.status, "spec_created");
    assert.match(finalized.blockPackage.spec, new RegExp(approvedPinId));

    const pinsMarkdown = await fs.readFile(path.join(projectPath, blockDir, "pins.md"), "utf8");
    const designSessionMarkdown = await fs.readFile(path.join(projectPath, blockDir, "design-session.md"), "utf8");
    const annotationMarkdown = await fs.readFile(path.join(projectPath, blockDir, "annotation-B-001.md"), "utf8");
    assert.match(pinsMarkdown, /Design Pins For B-001/);
    assert.match(designSessionMarkdown, /Conversation Decisions/);
    assert.match(annotationMarkdown, /approved/);
  } finally {
    await client.close();
  }
});

function concreteSpecWithDesignPins(blockId: string, title: string, objective: string, paperIds: string[], directiveIds: string[], pinIds: string[]): string {
  return concreteSpec(blockId, title, objective, paperIds, directiveIds).replace(
    "## Acceptance Criteria",
    [
      "## Design Session Pins And Checkpoints",
      ...pinIds.map((pinId) => `${pinId}: Preserve this finalized design session checkpoint as an implementation effect. The spec must cite the pin, keep the original plan scope grounded, and reject generic drift or unrelated block expansion.`),
      "",
      "## Acceptance Criteria"
    ].join("\n")
  );
}
function concreteSpec(blockId: string, title: string, objective: string, paperIds = ["P-001", "P-002"], directiveIds: string[] = []): string {
  return [
    `# Implementation Spec For ${blockId} ${title}`,
    "",
    "## Block Identity And Source Scope",
    `This specification is only for ${blockId}: ${title}. It must implement the exact behavior described by block.md and the approved extracted-research.md. The scope is limited to this block package and must not advance unrelated blocks. Source evidence comes from block.md, papers.md, extracted-research.md, and P-001/P-002 where attached in this test fixture.`,
    "",
    "## Concrete Implementation Requirements",
    objective,
    "The implementation must preserve stable block ids, source references, and evidence links. It must turn the approved research into explicit implementation behavior rather than generic project scaffolding. It must be deterministic for the same input markdown and stored state.",
    "",
    "## Interfaces And Data Contracts",
    "Expose persisted markdown artifacts with stable paths, JSON state records with block id, status, dependency references, research references, and implementation records. Inputs are projectPath, blockId, markdown content, source references, and approved reviewer metadata. Outputs are updated state.json, block markdown files, graph exports, and implementation context strings.",
    "",
    "## Files And Artifacts To Create Or Modify",
    "Modify the block package files that are owned by this block: block.md when state changes, spec.md for this approved specification, implementation.md when implementation is recorded, graph.md/graph.json when dependencies or status change, and .planner/state.json for persistent workflow state. Modify source files only when strict implementation context is later requested.",
    "",
    "## Artifacts To Remove Or Replace",
    "No artifacts to remove for this test fixture. If stale generated specs, placeholder spec sections, or obsolete block outputs exist during real implementation, replace them with concrete approved files rather than leaving duplicate placeholder artifacts in the project.",
    "",
    "## Non-Goals And Boundaries",
    "Do not implement unrelated blocks. Do not create generic foundation phases. Do not invent unapproved research. Do not remove user-authored files outside this block package. Do not mark implementation complete until record_implementation is called after actual code changes.",
    "",
    "## Implementation Steps",
    "1. Read block.md and approved extracted-research.md for the active block. 2. Preserve the implementation target language and framework. 3. Update only the block-owned artifacts and state transitions required by the requested MCP stage. 4. Keep dependency and related-block references intact. 5. Produce implementation context that includes approved spec, approved research, papers, dependency summaries, and related block summaries.",
    "",
    "## Paper Model Fit And Adapter Map",
    ...paperModelFitEntries(paperIds),
    "",
    ...implementationDirectiveSection(directiveIds),
    "## Acceptance Criteria",
    "The block spec references the exact block id. The spec has no placeholder text. The spec states implementation boundaries, artifacts to create or modify, artifacts to remove or replace, data contracts, implementation steps, and verification requirements. The ready-block gate still prevents implementation before research/spec approval.",
    "",
    "## Verification Plan",
    "Run npm run build and node --test dist/tests. Verify strict implementation context fails before spec approval and succeeds after approval. Verify implementation target text appears in spec.md and implementation context. Verify graph export still contains dependency edges.",
    "",
    "## Traceability To Block And Research",
    "Trace this spec to block.md responsibilities, extracted-research.md relevant claims, papers.md attached evidence, and source plan references. In this test fixture P-001 and P-002 demonstrate attached-paper and online-paper reference handling for block-specific evidence.",
    ""
  ].join("\n");
}
function implementationDirectiveSection(directiveIds: string[]): string[] {
  if (directiveIds.length === 0) {
    return [];
  }

  return [
    "## Implementation Directives",
    ...directiveIds.flatMap((directiveId) => [
      `### ${directiveId} Approved Directive`,
      `${directiveId} must be honored as an approved implementation directive. The spec must use the Traceable Planning Notes evidence from extracted-research.md as the selected source-reference preservation behavior for markdown plan inputs.`,
      "Implementation effect: source intake must preserve stable block ids, exact source references, directive provenance, and downstream traceability instead of treating the evidence as a loose research note.",
      "Boundary: this directive must not implement unrelated blocks, must not bypass strict implementation context, and does not create final code before the approved implementation stage.",
      ""
    ]),
    ""
  ];
}
function concreteSpecWithoutPaperModelFit(blockId: string, title: string, objective: string): string {
  return concreteSpec(blockId, title, objective).replace(/\n## Paper Model Fit And Adapter Map\n[\s\S]*?\n## Acceptance Criteria\n/, "\n## Acceptance Criteria\n");
}

function paperModelFitEntries(paperIds: string[]): string[] {
  if (paperIds.length === 0) {
    return ["No attached papers. No paper model adapters required for this block."];
  }

  return paperIds.flatMap((paperId) => [
    `### ${paperId} Test Paper Model Fit`,
    "Implementation role: supplies block-specific evidence behavior for the active workflow stage.",
    "Processing step: used in the implementation steps that read block.md, papers.md, and extracted-research.md before producing state transitions.",
    "Adapter/interface: ResearchEvidenceAdapter converts paper-backed claims into explicit planner records.",
    "Consumes: block id, source plan references, papers.md entries, extracted research claims, and implementation target records.",
    "Produces: updated spec.md requirements, provenance records, graph/state updates, and implementation context text.",
    "Provenance: records paper_support, producer_name, source_model or algorithm source, and source block references for every derived behavior.",
    "Confidence and uncertainty handling: keeps confidence, score, ambiguity, and risk notes explicit instead of treating research claims as final implementation truth.",
    "Boundaries: must not implement unrelated blocks, must not invent unapproved research, and does not produce final code until strict implementation context is requested.",
    ""
  ]);
}

function concreteAnnotation(topic: string): string {
  return [
    `This annotation is based on the selected source excerpt: ${topic}. The source evidence is the local extracted-research.md entry plus the supplied source URL https://arxiv.org/abs/0000.00000, so provenance remains attached to the block package instead of being treated as an approved design change.`,
    "",
    "Implementation relevance: the note clarifies that traceability evidence can inform future research notes and source-linked implementation decisions, but it does not itself create a model adapter, data contract, command, API, or implementation file. Any later spec must still decide exact adapter names, consumed records, produced records, provenance fields, confidence handling, and test evidence before code is written.",
    "",
    "Boundary: this annotation must not approve research, create or replace spec.md, approve a spec, implement code, record implementation, verify a block, or change block status. It does not replace papers.md and does not mark any source as accepted without review. The annotation only appends traceable context to the requested target file."
  ].join("\n");
}

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


