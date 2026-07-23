import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { PlannerStore } from "./storage.js";
import { BLOCK_STATUSES } from "./types.js";
import type { ToolResultData } from "./types.js";
import { toJsonText } from "./utils.js";

const projectPath = z.string().optional().describe("Project directory relative to the MCP server working directory.");
const blockId = z.string().describe("Block id such as B-001.");
const stringList = z.array(z.string()).optional();
const implementationContextMode = z.enum(["implement", "reimplement"]).optional()
  .describe("Default implement only allows ready blocks. Use reimplement only when the user explicitly requests reimplementation of an implemented or verified block.");

const planBlockSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  purpose: z.string().optional(),
  responsibilities: z.array(z.string()).optional(),
  inputs: z.array(z.string()).optional(),
  outputs: z.array(z.string()).optional(),
  depends_on: z.array(z.string()).optional(),
  related_blocks: z.array(z.string()).optional(),
  research_questions: z.array(z.string()).optional(),
  implementation_criteria: z.array(z.string()).optional(),
  source_plan_refs: z.array(z.string()).optional(),
  source_excerpt: z.string().optional()
});

export function createPlannerServer(): McpServer {
  const server = new McpServer(
    {
      name: "deep_learning_auto_research",
      version: "0.1.0"
    },
    {
      instructions: [
        "Use this server to manage markdown-backed implementation planning.",
        "Blocks must represent actual decomposed parts of the supplied plan, not generic project phases.",
        "Before creating specs or implementing blocks, set the project implementation target with language and framework.",
        "Do not implement a block until planner.prepare_implementation_context succeeds in strict mode.",
        "When extracting research, store only block-specific information and preserve evidence references.",
        "For online papers, prepare search queries, search primary sources, add discovered papers as references, extract block-specific evidence, create spec.md, then implement from the approved spec."
      ].join(" ")
    }
  );

  server.registerTool(
    "planner.create_project",
    {
      title: "Create Planner Project",
      description: "Create the markdown-backed planner directory structure and initial state.",
      inputSchema: {
        projectPath,
        planFileName: z.string().optional().describe("Plan filename. Defaults to system-plan.md.")
      }
    },
    async ({ projectPath: pathArg, planFileName }) => ok(await new PlannerStore(pathArg).createProject(planFileName))
  );

  server.registerTool(
    "planner.ingest_plan",
    {
      title: "Ingest System Plan",
      description: "Write or import a markdown system plan into the planner project.",
      inputSchema: {
        projectPath,
        content: z.string().optional(),
        planPath: z.string().optional(),
        planFileName: z.string().optional(),
        title: z.string().optional()
      }
    },
    async (args) => ok(await new PlannerStore(args.projectPath).ingestPlan(args))
  );

  server.registerTool(
    "planner.set_implementation_target",
    {
      title: "Set Implementation Target",
      description: "Set the project implementation language and framework that all generated specs and strict implementation contexts must use.",
      inputSchema: {
        projectPath,
        language: z.string().min(1),
        framework: z.string().min(1)
      }
    },
    async ({ projectPath: pathArg, language, framework }) =>
      ok(await new PlannerStore(pathArg).setImplementationTarget({ language, framework }))
  );

  server.registerTool(
    "planner.get_implementation_target",
    {
      title: "Get Implementation Target",
      description: "Read the project implementation language and framework.",
      inputSchema: {
        projectPath
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ projectPath: pathArg }) => ok(await new PlannerStore(pathArg).getImplementationTarget())
  );

  server.registerTool(
    "planner.decompose_plan",
    {
      title: "Decompose Plan",
      description: "Propose or write plan-derived implementation blocks. Defaults to merged blocks with maxBlocks=12; pass preserveSections=true to keep every source heading as its own block.",
      inputSchema: {
        projectPath,
        blocks: z.array(planBlockSchema).optional(),
        maxBlocks: z.number().int().min(1).max(200).optional(),
        preserveSections: z.boolean().optional(),
        write: z.boolean().optional(),
        replace: z.boolean().optional()
      }
    },
    async (args) => ok(await new PlannerStore(args.projectPath).decomposePlan(args))
  );

  server.registerTool(
    "planner.list_blocks",
    {
      title: "List Blocks",
      description: "List all implementation blocks and their current states.",
      inputSchema: {
        projectPath
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ projectPath: pathArg }) => ok(await new PlannerStore(pathArg).listBlocks())
  );

  server.registerTool(
    "planner.read_block",
    {
      title: "Read Block",
      description: "Read a block package: block markdown, attached papers, extracted research, and implementation notes.",
      inputSchema: {
        projectPath,
        blockId
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ projectPath: pathArg, blockId: id }) => ok(await new PlannerStore(pathArg).readBlock(id))
  );

  server.registerTool(
    "planner.update_block",
    {
      title: "Update Block",
      description: "Update block metadata or body, including dependency and related-block cross references.",
      inputSchema: {
        projectPath,
        blockId,
        title: z.string().optional(),
        status: z.enum(BLOCK_STATUSES).optional(),
        depends_on: stringList,
        related_blocks: stringList,
        body: z.string().optional(),
        research_questions: stringList,
        implementation_criteria: stringList
      }
    },
    async (args) => ok(await new PlannerStore(args.projectPath).updateBlock(args))
  );

  server.registerTool(
    "planner.attach_paper",
    {
      title: "Attach Paper",
      description: "Attach a research paper or paper text to a specific block.",
      inputSchema: {
        projectPath,
        blockId,
        paperPath: z.string().optional(),
        sourceUrl: z.string().optional(),
        content: z.string().optional(),
        title: z.string().optional(),
        citation: z.string().optional(),
        authors: stringList,
        year: z.string().optional(),
        venue: z.string().optional(),
        doi: z.string().optional(),
        arxivId: z.string().optional(),
        notes: z.string().optional(),
        abstract: z.string().optional(),
        relevant_sections: stringList,
        discoverySource: z.enum(["user_upload", "codex_online", "manual_reference"]).optional(),
        relevanceScore: z.number().min(0).max(1).optional(),
        copy: z.boolean().optional()
      }
    },
    async (args) => ok(await new PlannerStore(args.projectPath).attachPaper(args))
  );

  server.registerTool(
    "planner.add_paper_reference",
    {
      title: "Add Online Paper Reference",
      description: "Attach a Codex-discovered online paper reference to a specific block without requiring a local PDF.",
      inputSchema: {
        projectPath,
        blockId,
        title: z.string(),
        sourceUrl: z.string(),
        citation: z.string().optional(),
        authors: stringList,
        year: z.string().optional(),
        venue: z.string().optional(),
        doi: z.string().optional(),
        arxivId: z.string().optional(),
        notes: z.string().optional(),
        abstract: z.string().optional(),
        relevant_sections: stringList,
        relevanceScore: z.number().min(0).max(1).optional()
      }
    },
    async (args) => ok(await new PlannerStore(args.projectPath).addPaperReference(args))
  );

  server.registerTool(
    "planner.list_papers",
    {
      title: "List Papers",
      description: "List all papers or the papers attached to one block.",
      inputSchema: {
        projectPath,
        blockId: z.string().optional()
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ projectPath: pathArg, blockId: id }) => ok(await new PlannerStore(pathArg).listPapers(id))
  );

  server.registerTool(
    "planner.prepare_research_context",
    {
      title: "Prepare Research Context",
      description: "Return the block and attached-paper context Codex should use before writing block-specific extraction.",
      inputSchema: {
        projectPath,
        blockId
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ projectPath: pathArg, blockId: id }) => ok(await new PlannerStore(pathArg).prepareResearchContext(id))
  );

  server.registerTool(
    "planner.prepare_online_research",
    {
      title: "Prepare Online Research",
      description: "Generate block-specific online paper search queries and instructions for Codex to find relevant primary papers.",
      inputSchema: {
        projectPath,
        blockId
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ projectPath: pathArg, blockId: id }) => ok(await new PlannerStore(pathArg).prepareOnlineResearch(id))
  );

  server.registerTool(
    "planner.extract_research",
    {
      title: "Store Extracted Research",
      description: "Store block-specific extracted research markdown. If omitted, creates a structured extraction template.",
      inputSchema: {
        projectPath,
        blockId,
        extractionMarkdown: z.string().optional(),
        generatedBy: z.string().optional()
      }
    },
    async (args) => ok(await new PlannerStore(args.projectPath).extractResearch(args))
  );

  server.registerTool(
    "planner.approve_research",
    {
      title: "Approve Research",
      description: "Approve extracted research for a block and make it eligible for implementation if dependencies are done.",
      inputSchema: {
        projectPath,
        blockId,
        approvedBy: z.string().optional(),
        notes: z.string().optional()
      }
    },
    async (args) => ok(await new PlannerStore(args.projectPath).approveResearch(args))
  );

  server.registerTool(
    "planner.create_spec",
    {
      title: "Create Block Spec",
      description: "Create spec.md for a block from block.md, papers.md, and extracted-research.md. Research must be approved first.",
      inputSchema: {
        projectPath,
        blockId,
        specMarkdown: z.string().optional(),
        generatedBy: z.string().optional()
      }
    },
    async (args) => ok(await new PlannerStore(args.projectPath).createSpec(args))
  );

  server.registerTool(
    "planner.approve_spec",
    {
      title: "Approve Block Spec",
      description: "Approve spec.md and make the block eligible for implementation if dependencies are done.",
      inputSchema: {
        projectPath,
        blockId,
        approvedBy: z.string().optional(),
        notes: z.string().optional()
      }
    },
    async (args) => ok(await new PlannerStore(args.projectPath).approveSpec(args))
  );

  server.registerTool(
    "planner.get_ready_blocks",
    {
      title: "Get Ready Blocks",
      description: "List blocks whose research is approved and dependencies are implemented or verified.",
      inputSchema: {
        projectPath
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ projectPath: pathArg }) => ok(await new PlannerStore(pathArg).getReadyBlocks())
  );

  server.registerTool(
    "planner.prepare_implementation_context",
    {
      title: "Prepare Implementation Context",
      description: "Return the approved block package Codex should implement from. Strict mode enforces approval, dependency, and implementation-target gates. Pass mode=reimplement only when the user explicitly asks to reimplement an already implemented or verified block.",
      inputSchema: {
        projectPath,
        blockId,
        strict: z.boolean().optional(),
        mode: implementationContextMode
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ projectPath: pathArg, blockId: id, strict, mode }) =>
      ok(await new PlannerStore(pathArg).prepareImplementationContext(id, strict ?? true, mode ?? "implement"))
  );

  server.registerTool(
    "planner.record_implementation",
    {
      title: "Record Implementation",
      description: "Record what Codex implemented for a block and move the block to implemented by default.",
      inputSchema: {
        projectPath,
        blockId,
        summary: z.string(),
        changedFiles: stringList,
        notes: z.string().optional(),
        markImplemented: z.boolean().optional()
      }
    },
    async (args) => ok(await new PlannerStore(args.projectPath).recordImplementation(args))
  );

  server.registerTool(
    "planner.verify_block",
    {
      title: "Verify Block",
      description: "Mark an implemented block as verified and record verification evidence.",
      inputSchema: {
        projectPath,
        blockId,
        evidence: z.string().optional(),
        verifier: z.string().optional()
      }
    },
    async (args) => ok(await new PlannerStore(args.projectPath).verifyBlock(args))
  );

  server.registerTool(
    "planner.export_graph",
    {
      title: "Export Graph",
      description: "Export the current block dependency graph as markdown and JSON.",
      inputSchema: {
        projectPath
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ projectPath: pathArg }) => ok(await new PlannerStore(pathArg).exportGraph())
  );

  server.registerTool(
    "planner.prepare_final_code_context",
    {
      title: "Prepare Final Code Context",
      description: "After all blocks are implemented, gather specs and implementation notes so Codex can translate the plan records into normal source-code files and tests.",
      inputSchema: {
        projectPath,
        strict: z.boolean().optional()
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ projectPath: pathArg, strict }) => ok(await new PlannerStore(pathArg).prepareFinalCodeContext(strict ?? true))
  );

  return server;
}

function ok(data: ToolResultData): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: toJsonText(data)
      }
    ],
    structuredContent: {
      result: data
    }
  };
}
