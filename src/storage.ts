import fs from "node:fs/promises";
import path from "node:path";
import { blockDirectoryName, decomposePlanText } from "./decompose.js";
import type { DecomposeOptions } from "./decompose.js";
import { parseMarkdownDocument, section, stringifyMarkdownDocument } from "./markdown.js";
import type {
  BlockMarkdownMeta,
  BlockRecord,
  BlockStatus,
  ImplementationContextMode,
  ImplementationTarget,
  PaperRecord,
  PlanBlockInput,
  PlannerState
} from "./types.js";
import { normalizeId, nowIso, relativeToProject, resolveProjectRoot, slugify, uniqueValues } from "./utils.js";

const STATE_VERSION = 1;
const IMPLEMENTABLE_STATUSES: BlockStatus[] = ["spec_approved", "ready_to_implement"];
const REIMPLEMENTABLE_STATUSES: BlockStatus[] = ["implemented", "verified"];
const COMPLETE_STATUSES: BlockStatus[] = ["implemented", "verified"];

export class PlannerStore {
  readonly root: string;

  constructor(projectPath?: string) {
    this.root = resolveProjectRoot(projectPath);
  }

  async createProject(planFileName = "system-plan.md"): Promise<PlannerState> {
    await fs.mkdir(this.root, { recursive: true });
    await fs.mkdir(this.blocksDir(), { recursive: true });
    await fs.mkdir(this.papersDir(), { recursive: true });
    await fs.mkdir(this.plannerDir(), { recursive: true });

    const planPath = path.join(this.root, planFileName);
    if (!(await exists(planPath))) {
      await fs.writeFile(planPath, "# System Plan\n\nDescribe the system plan here.\n", "utf8");
    }

    const statePath = this.statePath();
    if (await exists(statePath)) {
      return this.loadState();
    }

    const now = nowIso();
    const state: PlannerState = {
      version: STATE_VERSION,
      plan_file: planFileName,
      created_at: now,
      updated_at: now,
      counters: {
        blocks: 0,
        papers: 0
      },
      blocks: {},
      papers: {}
    };

    await this.saveState(state);
    await this.writeGraphFiles(state);
    await this.audit("project_created", { planFileName });
    return state;
  }

  async ingestPlan(args: { content?: string; planPath?: string; planFileName?: string; title?: string }): Promise<{
    planFile: string;
    path: string;
    bytes: number;
  }> {
    const state = await this.ensureProject(args.planFileName);
    const planFile = args.planFileName ?? state.plan_file;
    const destination = path.join(this.root, planFile);

    let content = args.content;
    if (!content && args.planPath) {
      content = await fs.readFile(path.resolve(this.root, args.planPath), "utf8");
    }

    if (!content) {
      throw new Error("Provide either plan content or planPath.");
    }

    const finalContent = args.title && !content.trimStart().startsWith("#")
      ? `# ${args.title}\n\n${content.trim()}\n`
      : ensureTrailingNewline(content);

    await fs.writeFile(destination, finalContent, "utf8");
    state.plan_file = planFile;
    state.updated_at = nowIso();
    await this.saveState(state);
    await this.audit("plan_ingested", { planFile });

    return {
      planFile,
      path: relativeToProject(this.root, destination),
      bytes: Buffer.byteLength(finalContent)
    };
  }

  async setImplementationTarget(args: { language: string; framework: string }): Promise<ImplementationTarget> {
    const state = await this.loadState();
    const target = normalizeImplementationTarget(args);
    state.implementation_target = target;
    state.updated_at = nowIso();
    await this.saveState(state);
    await this.audit("implementation_target_set", target);
    return target;
  }

  async getImplementationTarget(): Promise<ImplementationTarget | null> {
    const state = await this.loadState();
    return state.implementation_target ?? null;
  }

  async proposeBlocks(options: DecomposeOptions = {}): Promise<PlanBlockInput[]> {
    const state = await this.loadState();
    const planPath = path.join(this.root, state.plan_file);
    const planText = await fs.readFile(planPath, "utf8");
    return decomposePlanText(planText, state.plan_file, options);
  }

  async decomposePlan(args: {
    blocks?: PlanBlockInput[];
    write?: boolean;
    replace?: boolean;
    maxBlocks?: number;
    preserveSections?: boolean;
  }): Promise<{
    written: boolean;
    blocks: BlockRecord[] | PlanBlockInput[];
    graph?: ReturnType<PlannerStore["buildGraph"]>;
  }> {
    const proposed = args.blocks && args.blocks.length > 0
      ? args.blocks
      : await this.proposeBlocks({
          maxBlocks: args.maxBlocks,
          preserveSections: args.preserveSections
        });

    if (!args.write) {
      return {
        written: false,
        blocks: proposed
      };
    }

    const state = await this.loadState();
    if (Object.keys(state.blocks).length > 0 && !args.replace) {
      throw new Error("Blocks already exist. Pass replace=true to rebuild the block set.");
    }

    if (args.replace) {
      await fs.rm(this.blocksDir(), { recursive: true, force: true });
      await fs.mkdir(this.blocksDir(), { recursive: true });
      state.blocks = {};
      state.counters.blocks = 0;
    }

    const records: BlockRecord[] = [];
    for (const block of proposed) {
      const record = await this.createBlock(state, block);
      records.push(record);
    }

    linkAdjacentBlocks(records);
    for (const record of records) {
      await this.writeBlockMarkdown(state.blocks[record.id], proposed.find((block) => block.title === record.title), state);
    }

    state.updated_at = nowIso();
    await this.saveState(state);
    await this.writeGraphFiles(state);
    await this.audit("plan_decomposed", { blockCount: records.length });

    return {
      written: true,
      blocks: Object.values(state.blocks),
      graph: this.buildGraph(state)
    };
  }

  async listBlocks(): Promise<BlockRecord[]> {
    const state = await this.loadState();
    return Object.values(state.blocks).sort((a, b) => a.id.localeCompare(b.id));
  }

  async readBlock(blockId: string): Promise<{
    record: BlockRecord;
    block: string;
    papers: string;
    extraction: string;
    spec: string;
    implementation: string;
  }> {
    const state = await this.loadState();
    const record = this.requireBlock(state, blockId);
    return {
      record,
      block: await readIfExists(path.join(this.root, record.dir, "block.md")),
      papers: await readIfExists(path.join(this.root, record.dir, "papers.md")),
      extraction: await readIfExists(path.join(this.root, record.dir, "extracted-research.md")),
      spec: await readIfExists(path.join(this.root, record.dir, "spec.md")),
      implementation: await readIfExists(path.join(this.root, record.dir, "implementation.md"))
    };
  }

  async updateBlock(args: {
    blockId: string;
    title?: string;
    status?: BlockStatus;
    depends_on?: string[];
    related_blocks?: string[];
    body?: string;
    research_questions?: string[];
    implementation_criteria?: string[];
  }): Promise<BlockRecord> {
    const state = await this.loadState();
    const record = this.requireBlock(state, args.blockId);
    const blockPath = path.join(this.root, record.dir, "block.md");
    const current = parseMarkdownDocument<BlockMarkdownMeta>(await fs.readFile(blockPath, "utf8"));

    if (args.title) {
      record.title = args.title;
      record.slug = slugify(args.title);
    }
    if (args.status) {
      record.status = args.status;
    }
    if (args.depends_on) {
      record.depends_on = this.validateBlockReferences(state, args.depends_on, record.id);
    }
    if (args.related_blocks) {
      record.related_blocks = this.validateBlockReferences(state, args.related_blocks, record.id);
    }

    record.updated_at = nowIso();
    state.updated_at = record.updated_at;
    state.blocks[record.id] = record;

    const nextMeta: BlockMarkdownMeta = {
      ...current.meta,
      ...record
    };

    const nextBody = args.body ?? current.body;
    await fs.writeFile(blockPath, stringifyMarkdownDocument(nextMeta, nextBody), "utf8");
    await this.saveState(state);
    await this.writeGraphFiles(state);
    await this.audit("block_updated", { blockId: record.id });
    return record;
  }

  async attachPaper(args: {
    blockId: string;
    paperPath?: string;
    sourceUrl?: string;
    content?: string;
    title?: string;
    citation?: string;
    authors?: string[];
    year?: string;
    venue?: string;
    doi?: string;
    arxivId?: string;
    notes?: string;
    abstract?: string;
    relevant_sections?: string[];
    discoverySource?: "user_upload" | "codex_online" | "manual_reference";
    relevanceScore?: number;
    copy?: boolean;
  }): Promise<PaperRecord> {
    const state = await this.loadState();
    const block = this.requireBlock(state, args.blockId);
    if (!args.paperPath && !args.content && !args.sourceUrl) {
      throw new Error("Provide paperPath, content, or sourceUrl.");
    }

    const id = nextId("P", ++state.counters.papers);
    const title = args.title ?? inferPaperTitle(args.paperPath, id);
    const extension = args.paperPath ? path.extname(args.paperPath) || ".pdf" : ".md";
    const storedFileName = `${id}-${slugify(title)}${extension}`;
    const storedAbsolutePath = path.join(this.papersDir(), storedFileName);

    if (args.content) {
      await fs.writeFile(storedAbsolutePath, ensureTrailingNewline(args.content), "utf8");
    } else if (!args.paperPath || args.copy === false) {
      // Reference-only attachments are useful for very large paper libraries.
    } else {
      await fs.copyFile(path.resolve(this.root, args.paperPath!), storedAbsolutePath);
    }

    const now = nowIso();
    const paper: PaperRecord = {
      id,
      title,
      citation: args.citation,
      authors: args.authors,
      year: args.year,
      venue: args.venue,
      doi: args.doi,
      arxiv_id: args.arxivId,
      source_url: args.sourceUrl,
      source_path: args.paperPath,
      stored_path: args.content || (args.paperPath && args.copy !== false) ? relativeToProject(this.root, storedAbsolutePath) : undefined,
      attached_to: [block.id],
      notes: args.notes,
      abstract: args.abstract,
      relevant_sections: args.relevant_sections ?? [],
      discovery_source: args.discoverySource ?? (args.sourceUrl && !args.paperPath ? "codex_online" : "user_upload"),
      relevance_score: args.relevanceScore,
      created_at: now,
      updated_at: now
    };

    state.papers[id] = paper;
    block.paper_ids = uniqueValues([...block.paper_ids, id]);
    block.status = block.status === "created" || block.status === "needs_research" ? "research_attached" : block.status;
    block.updated_at = now;
    state.updated_at = now;

    await this.writePapersMarkdown(block, state);
    await this.writeBlockMarkdown(block, undefined, state);
    await this.saveState(state);
    await this.audit("paper_attached", { blockId: block.id, paperId: id });
    return paper;
  }

  async addPaperReference(args: {
    blockId: string;
    title: string;
    sourceUrl: string;
    citation?: string;
    authors?: string[];
    year?: string;
    venue?: string;
    doi?: string;
    arxivId?: string;
    notes?: string;
    abstract?: string;
    relevant_sections?: string[];
    relevanceScore?: number;
  }): Promise<PaperRecord> {
    return this.attachPaper({
      ...args,
      discoverySource: "codex_online",
      copy: false
    });
  }

  async listPapers(blockId?: string): Promise<PaperRecord[]> {
    const state = await this.loadState();
    const papers = Object.values(state.papers);
    return (blockId ? papers.filter((paper) => paper.attached_to.includes(normalizeId(blockId))) : papers)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async prepareResearchContext(blockId: string): Promise<{
    block: string;
    papers: PaperRecord[];
    paperText: Array<{ paperId: string; path?: string; content?: string }>;
    onlineResearch: ReturnType<PlannerStore["buildOnlineResearchPlan"]>;
  }> {
    const state = await this.loadState();
    const block = this.requireBlock(state, blockId);
    const papers = block.paper_ids.map((paperId) => this.requirePaper(state, paperId));
    const paperText = [];

    for (const paper of papers) {
      if (!paper.stored_path || path.extname(paper.stored_path).toLowerCase() !== ".md") {
        paperText.push({ paperId: paper.id, path: paper.stored_path });
        continue;
      }

      paperText.push({
        paperId: paper.id,
        path: paper.stored_path,
        content: await fs.readFile(path.join(this.root, paper.stored_path), "utf8")
      });
    }

    return {
      block: await fs.readFile(path.join(this.root, block.dir, "block.md"), "utf8"),
      papers,
      paperText,
      onlineResearch: this.buildOnlineResearchPlan(block, await fs.readFile(path.join(this.root, block.dir, "block.md"), "utf8"))
    };
  }

  async prepareOnlineResearch(blockId: string): Promise<ReturnType<PlannerStore["buildOnlineResearchPlan"]>> {
    const state = await this.loadState();
    const block = this.requireBlock(state, blockId);
    const blockMarkdown = await fs.readFile(path.join(this.root, block.dir, "block.md"), "utf8");
    return this.buildOnlineResearchPlan(block, blockMarkdown);
  }

  async extractResearch(args: { blockId: string; extractionMarkdown?: string; generatedBy?: string }): Promise<{
    block: BlockRecord;
    path: string;
  }> {
    const state = await this.loadState();
    const block = this.requireBlock(state, args.blockId);
    const extractionPath = path.join(this.root, block.dir, "extracted-research.md");
    const markdown = args.extractionMarkdown ?? researchExtractionTemplate(block, state);

    await fs.writeFile(extractionPath, ensureTrailingNewline(markdown), "utf8");
    block.status = "research_extracted";
    block.updated_at = nowIso();
    state.updated_at = block.updated_at;
    await this.writeBlockMarkdown(block, undefined, state);
    await this.saveState(state);
    await this.audit("research_extracted", { blockId: block.id, generatedBy: args.generatedBy });

    return {
      block,
      path: relativeToProject(this.root, extractionPath)
    };
  }

  async approveResearch(args: { blockId: string; approvedBy?: string; notes?: string }): Promise<BlockRecord> {
    const state = await this.loadState();
    const block = this.requireBlock(state, args.blockId);
    const extractionPath = path.join(this.root, block.dir, "extracted-research.md");
    const extraction = await readIfExists(extractionPath);

    if (extraction.trim().length === 0) {
      throw new Error(`Block ${block.id} has no extracted research to approve.`);
    }

    block.status = "research_approved";
    block.updated_at = nowIso();
    state.updated_at = block.updated_at;
    await fs.appendFile(
      extractionPath,
      `\n## Approval\nApproved at: ${block.updated_at}\nApproved by: ${args.approvedBy ?? "user"}\nNotes: ${args.notes ?? "None"}\n`,
      "utf8"
    );
    await this.writeBlockMarkdown(block, undefined, state);
    await this.saveState(state);
    await this.audit("research_approved", { blockId: block.id, approvedBy: args.approvedBy });
    return block;
  }

  async createSpec(args: { blockId: string; specMarkdown?: string; generatedBy?: string }): Promise<{
    block: BlockRecord;
    path: string;
  }> {
    const state = await this.loadState();
    const block = this.requireBlock(state, args.blockId);
    if (block.status !== "research_approved" && block.status !== "spec_created" && block.status !== "spec_approved" && block.status !== "ready_to_implement") {
      throw new Error(`Block ${block.id} research must be approved before creating spec.md. Current status: ${block.status}.`);
    }

    const implementationTarget = requireImplementationTarget(state);
    const specPath = path.join(this.root, block.dir, "spec.md");
    const markdown = ensureSpecImplementationTarget(
      args.specMarkdown ?? await this.specTemplate(state, block),
      implementationTarget
    );
    await fs.writeFile(specPath, ensureTrailingNewline(markdown), "utf8");
    block.status = "spec_created";
    block.updated_at = nowIso();
    state.updated_at = block.updated_at;
    await this.writeBlockMarkdown(block, undefined, state);
    await this.saveState(state);
    await this.audit("spec_created", { blockId: block.id, generatedBy: args.generatedBy });

    return {
      block,
      path: relativeToProject(this.root, specPath)
    };
  }

  async approveSpec(args: { blockId: string; approvedBy?: string; notes?: string }): Promise<BlockRecord> {
    const state = await this.loadState();
    const block = this.requireBlock(state, args.blockId);
    const specPath = path.join(this.root, block.dir, "spec.md");
    const spec = await readIfExists(specPath);
    if (spec.trim().length === 0) {
      throw new Error(`Block ${block.id} has no spec.md to approve.`);
    }

    block.status = this.dependenciesSatisfied(state, block) ? "ready_to_implement" : "spec_approved";
    block.updated_at = nowIso();
    state.updated_at = block.updated_at;
    await fs.appendFile(
      specPath,
      `\n## Spec Approval\nApproved at: ${block.updated_at}\nApproved by: ${args.approvedBy ?? "user"}\nNotes: ${args.notes ?? "None"}\n`,
      "utf8"
    );
    await this.writeBlockMarkdown(block, undefined, state);
    await this.saveState(state);
    await this.audit("spec_approved", { blockId: block.id, approvedBy: args.approvedBy });
    return block;
  }

  async getReadyBlocks(): Promise<BlockRecord[]> {
    const state = await this.loadState();
    return Object.values(state.blocks)
      .filter((block) => IMPLEMENTABLE_STATUSES.includes(block.status) && this.dependenciesSatisfied(state, block))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async prepareImplementationContext(blockId: string, strict = true, mode: ImplementationContextMode = "implement"): Promise<{
    blockId: string;
    status: BlockStatus;
    mode: ImplementationContextMode;
    context: string;
  }> {
    if (mode !== "implement" && mode !== "reimplement") {
      throw new Error(`Unsupported implementation context mode: ${mode}. Use implement or reimplement.`);
    }

    const state = await this.loadState();
    const block = this.requireBlock(state, blockId);
    const dependenciesSatisfied = this.dependenciesSatisfied(state, block);
    const canImplement = IMPLEMENTABLE_STATUSES.includes(block.status) && dependenciesSatisfied;
    const canReimplement = REIMPLEMENTABLE_STATUSES.includes(block.status) && dependenciesSatisfied;
    const canProceed = mode === "reimplement" ? canImplement || canReimplement : canImplement;
    const implementationTarget = strict ? requireImplementationTarget(state) : state.implementation_target;

    if (strict && !canProceed) {
      throw new Error(`Block ${block.id} is not ready to ${mode}. Current status: ${block.status}.`);
    }

    const blockMarkdown = await fs.readFile(path.join(this.root, block.dir, "block.md"), "utf8");
    const extraction = await readIfExists(path.join(this.root, block.dir, "extracted-research.md"));
    const spec = await readIfExists(path.join(this.root, block.dir, "spec.md"));
    if (strict && !specHasImplementationTarget(spec, implementationTarget!)) {
      throw new Error(`Block ${block.id} spec.md must include Implementation Target language ${implementationTarget!.language} and framework ${implementationTarget!.framework}.`);
    }
    const papers = await readIfExists(path.join(this.root, block.dir, "papers.md"));
    const implementation = await readIfExists(path.join(this.root, block.dir, "implementation.md"));
    const dependencySummaries = await this.dependencySummaries(state, block);
    const relatedSummaries = await this.relatedSummaries(state, block);

    const context = [
      `# Implementation Context For ${block.id} ${block.title}`,
      "",
      "## Readiness",
      `Status: ${block.status}`,
      `Mode: ${mode}`,
      `Dependencies satisfied: ${dependenciesSatisfied}`,
      "",
      ...(mode === "reimplement"
        ? [
            "## Reimplementation Mode",
            "This block was already implemented or verified. Reimplement only because the user explicitly requested mode reimplement.",
            "Previous implementation notes are included in this context.",
            ""
          ]
        : []),
      "## Implementation Target",
      implementationTarget
        ? [`Language: ${implementationTarget.language}`, `Framework: ${implementationTarget.framework}`].join("\n")
        : "No implementation target set.",
      "",
      "## Block",
      blockMarkdown.trim(),
      "",
      "## Approved Extracted Research",
      extraction.trim() || "No extracted research recorded.",
      "",
      "## Approved Implementation Spec",
      spec.trim() || "No spec.md recorded.",
      "",
      "## Attached Papers",
      papers.trim() || "No attached papers recorded.",
      "",
      "## Previous Implementation Notes",
      implementation.trim() || "No implementation notes recorded.",
      "",
      "## Dependency Summaries",
      dependencySummaries || "No dependencies.",
      "",
      "## Related Block Summaries",
      relatedSummaries || "No related blocks."
    ].join("\n");

    return {
      blockId: block.id,
      status: block.status,
      mode,
      context
    };
  }

  async recordImplementation(args: {
    blockId: string;
    summary: string;
    changedFiles?: string[];
    notes?: string;
    markImplemented?: boolean;
  }): Promise<BlockRecord> {
    const state = await this.loadState();
    const block = this.requireBlock(state, args.blockId);
    const implementationPath = path.join(this.root, block.dir, "implementation.md");
    const timestamp = nowIso();
    const entry = [
      `\n## Implementation Record ${timestamp}`,
      "",
      "### Summary",
      args.summary,
      "",
      "### Changed Files",
      ...(args.changedFiles && args.changedFiles.length > 0 ? args.changedFiles.map((file) => `- ${file}`) : ["- None recorded"]),
      "",
      "### Notes",
      args.notes ?? "None",
      ""
    ].join("\n");

    await fs.appendFile(implementationPath, entry, "utf8");
    block.status = args.markImplemented === false ? "implementing" : "implemented";
    block.updated_at = timestamp;
    state.updated_at = timestamp;
    await this.writeBlockMarkdown(block, undefined, state);
    await this.saveState(state);
    await this.audit("implementation_recorded", { blockId: block.id });
    return block;
  }

  async verifyBlock(args: { blockId: string; evidence?: string; verifier?: string }): Promise<BlockRecord> {
    const state = await this.loadState();
    const block = this.requireBlock(state, args.blockId);
    if (block.status !== "implemented" && block.status !== "verified") {
      throw new Error(`Block ${block.id} must be implemented before verification. Current status: ${block.status}.`);
    }

    const timestamp = nowIso();
    await fs.appendFile(
      path.join(this.root, block.dir, "implementation.md"),
      [
        `\n## Verification ${timestamp}`,
        `Verifier: ${args.verifier ?? "user"}`,
        "",
        args.evidence ?? "No additional evidence recorded.",
        ""
      ].join("\n"),
      "utf8"
    );
    block.status = "verified";
    block.updated_at = timestamp;
    state.updated_at = timestamp;
    await this.writeBlockMarkdown(block, undefined, state);
    await this.saveState(state);
    await this.writeGraphFiles(state);
    await this.audit("block_verified", { blockId: block.id });
    return block;
  }

  async exportGraph(): Promise<{ graph: ReturnType<PlannerStore["buildGraph"]>; markdown: string }> {
    const state = await this.loadState();
    await this.writeGraphFiles(state);
    return {
      graph: this.buildGraph(state),
      markdown: await fs.readFile(path.join(this.root, "graph.md"), "utf8")
    };
  }

  async prepareFinalCodeContext(strict = true): Promise<{
    allImplemented: boolean;
    pendingBlocks: Array<{ id: string; title: string; status: BlockStatus }>;
    context: string;
  }> {
    const state = await this.loadState();
    const blocks = Object.values(state.blocks).sort((a, b) => a.id.localeCompare(b.id));
    const pendingBlocks = blocks
      .filter((block) => !COMPLETE_STATUSES.includes(block.status))
      .map((block) => ({ id: block.id, title: block.title, status: block.status }));

    if (strict && pendingBlocks.length > 0) {
      throw new Error(`Cannot prepare final code context while blocks are pending: ${pendingBlocks.map((block) => `${block.id}:${block.status}`).join(", ")}`);
    }

    const sections = [];
    for (const block of blocks) {
      const spec = await readIfExists(path.join(this.root, block.dir, "spec.md"));
      const implementation = await readIfExists(path.join(this.root, block.dir, "implementation.md"));
      sections.push([
        `## ${block.id} ${block.title}`,
        `Status: ${block.status}`,
        "",
        "### Spec",
        spec.trim() || "No spec recorded.",
        "",
        "### Implementation Notes",
        implementation.trim() || "No implementation notes recorded."
      ].join("\n"));
    }

    return {
      allImplemented: pendingBlocks.length === 0,
      pendingBlocks,
      context: [
        "# Final Code Synthesis Context",
        "",
        "Use this context to reconcile block implementation notes with actual source-code files.",
        "The output should be normal programming-language files and tests, not more planning markdown.",
        "Preserve traceability by referencing block ids in implementation records or code comments only where useful.",
        "",
        ...sections
      ].join("\n\n")
    };
  }

  async loadState(): Promise<PlannerState> {
    const statePath = this.statePath();
    if (!(await exists(statePath))) {
      throw new Error("Planner project has not been created. Call planner.create_project first.");
    }

    const parsed = JSON.parse(await fs.readFile(statePath, "utf8")) as PlannerState;
    if (parsed.version !== STATE_VERSION) {
      throw new Error(`Unsupported planner state version: ${parsed.version}`);
    }

    return parsed;
  }

  private async ensureProject(planFileName?: string): Promise<PlannerState> {
    try {
      return await this.loadState();
    } catch {
      return this.createProject(planFileName);
    }
  }

  private async saveState(state: PlannerState): Promise<void> {
    state.updated_at = nowIso();
    await fs.mkdir(this.plannerDir(), { recursive: true });
    await fs.writeFile(this.statePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  private async createBlock(state: PlannerState, block: PlanBlockInput): Promise<BlockRecord> {
    const id = normalizeId(block.id ?? nextId("B", state.counters.blocks + 1));
    if (state.blocks[id]) {
      throw new Error(`Duplicate block id: ${id}`);
    }
    state.counters.blocks = Math.max(state.counters.blocks, numericSuffix(id));

    const now = nowIso();
    const record: BlockRecord = {
      id,
      title: block.title,
      slug: slugify(block.title),
      dir: `blocks/${blockDirectoryName(id, block.title)}`,
      status: "needs_research",
      depends_on: uniqueValues(block.depends_on ?? []).map(normalizeId),
      related_blocks: uniqueValues(block.related_blocks ?? []).map(normalizeId),
      source_plan_refs: uniqueValues(block.source_plan_refs ?? []),
      paper_ids: [],
      created_at: now,
      updated_at: now
    };

    state.blocks[id] = record;
    await fs.mkdir(path.join(this.root, record.dir), { recursive: true });
    await this.writeBlockMarkdown(record, block, state);
    await fs.writeFile(path.join(this.root, record.dir, "papers.md"), papersMarkdown(record, []), "utf8");
    await fs.writeFile(path.join(this.root, record.dir, "extracted-research.md"), "", "utf8");
    await fs.writeFile(path.join(this.root, record.dir, "spec.md"), "", "utf8");
    await fs.writeFile(path.join(this.root, record.dir, "implementation.md"), `# Implementation For ${record.id} ${record.title}\n`, "utf8");
    return record;
  }

  private async writeBlockMarkdown(record: BlockRecord, input?: PlanBlockInput, state?: PlannerState): Promise<void> {
    const blockPath = path.join(this.root, record.dir, "block.md");
    let sourceExcerpt = input?.source_excerpt;
    let existingBody: string | undefined;

    if (!input && await exists(blockPath)) {
      const existing = parseMarkdownDocument<BlockMarkdownMeta>(await fs.readFile(blockPath, "utf8"));
      sourceExcerpt = existing.meta.source_excerpt;
      existingBody = existing.body;
    }

    const meta: BlockMarkdownMeta = {
      ...record,
      source_excerpt: sourceExcerpt
    };

    const body = existingBody ?? [
      `# ${record.title}`,
      "",
      section("Purpose", input?.purpose),
      section("Source From Original Plan", input?.source_excerpt),
      section("Responsibilities", input?.responsibilities),
      section("Inputs", input?.inputs),
      section("Outputs", input?.outputs),
      section("Dependencies", record.depends_on.map((id) => crossRef(id, state))),
      section("Related Blocks", record.related_blocks.map((id) => crossRef(id, state))),
      section("Research Questions", input?.research_questions),
      section("Implementation Criteria", input?.implementation_criteria),
      section("Open Questions", "TBD")
    ].join("\n");

    await fs.writeFile(blockPath, stringifyMarkdownDocument(meta, body), "utf8");
  }

  private async writePapersMarkdown(block: BlockRecord, state: PlannerState): Promise<void> {
    const papers = block.paper_ids.map((paperId) => this.requirePaper(state, paperId));
    await fs.writeFile(path.join(this.root, block.dir, "papers.md"), papersMarkdown(block, papers), "utf8");
  }

  private buildOnlineResearchPlan(block: BlockRecord, blockMarkdown: string) {
    const keywords = extractKeywords(`${block.title}\n${blockMarkdown}`);
    const base = block.title.replace(/^\d+(?:\.\d+)*\.?\s+/, "");
    const queries = uniqueValues([
      `${base} research paper computer vision`,
      `${base} arXiv survey method`,
      `${keywords.slice(0, 6).join(" ")} paper`,
      `${keywords.slice(0, 4).join(" ")} benchmark dataset`
    ]).filter((query) => query.trim().length > 8);

    return {
      blockId: block.id,
      title: block.title,
      queries,
      instructions: [
        "Search online for papers that directly support this block only.",
        "Prefer primary sources: arXiv, ACL Anthology, CVF/OpenAccess, IEEE, ACM, Springer, Nature, official project pages, or publisher pages.",
        "Avoid generic blog posts unless they point to a primary paper.",
        "For each useful paper, call planner.add_paper_reference with title, URL, citation, abstract, relevance notes, and relevant sections.",
        "Do not extract broad paper summaries. Extract only evidence needed for this block."
      ]
    };
  }

  private buildGraph(state: PlannerState) {
    return {
      blocks: Object.values(state.blocks)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((block) => ({
          id: block.id,
          title: block.title,
          status: block.status,
          depends_on: block.depends_on,
          related_blocks: block.related_blocks,
          paper_ids: block.paper_ids
        })),
      edges: Object.values(state.blocks).flatMap((block) => [
        ...block.depends_on.map((target) => ({ from: block.id, to: target, type: "depends_on" })),
        ...block.related_blocks.map((target) => ({ from: block.id, to: target, type: "related_to" }))
      ])
    };
  }

  private async writeGraphFiles(state: PlannerState): Promise<void> {
    const graph = this.buildGraph(state);
    await fs.writeFile(path.join(this.plannerDir(), "graph.json"), `${JSON.stringify(graph, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(this.root, "graph.md"), graphMarkdown(graph), "utf8");
  }

  private dependenciesSatisfied(state: PlannerState, block: BlockRecord): boolean {
    return block.depends_on.every((id) => {
      const dependency = state.blocks[id];
      return dependency && COMPLETE_STATUSES.includes(dependency.status);
    });
  }

  private async dependencySummaries(state: PlannerState, block: BlockRecord): Promise<string> {
    const summaries = [];
    for (const dependencyId of block.depends_on) {
      const dependency = state.blocks[dependencyId];
      if (!dependency) {
        summaries.push(`- ${dependencyId}: missing`);
        continue;
      }

      const implementation = await readIfExists(path.join(this.root, dependency.dir, "implementation.md"));
      summaries.push(`## ${dependency.id} ${dependency.title}\nStatus: ${dependency.status}\n\n${implementation.trim() || "No implementation notes."}`);
    }

    return summaries.join("\n\n");
  }

  private async relatedSummaries(state: PlannerState, block: BlockRecord): Promise<string> {
    const summaries = [];
    for (const relatedId of block.related_blocks) {
      const related = state.blocks[relatedId];
      if (!related) {
        summaries.push(`- ${relatedId}: missing`);
        continue;
      }

      const markdown = await fs.readFile(path.join(this.root, related.dir, "block.md"), "utf8");
      summaries.push(`## ${related.id} ${related.title}\nStatus: ${related.status}\n\n${markdown.slice(0, 1200).trim()}`);
    }

    return summaries.join("\n\n");
  }

  private async specTemplate(state: PlannerState, block: BlockRecord): Promise<string> {
    const blockMarkdown = await fs.readFile(path.join(this.root, block.dir, "block.md"), "utf8");
    const papers = await readIfExists(path.join(this.root, block.dir, "papers.md"));
    const extraction = await readIfExists(path.join(this.root, block.dir, "extracted-research.md"));

    return [
      `# Implementation Spec For ${block.id} ${block.title}`,
      "",
      "## Implementation Target",
      implementationTargetMarkdown(requireImplementationTarget(state)),
      "",
      "## Source Block",
      blockMarkdown.trim(),
      "",
      "## Curated Papers",
      papers.trim() || "No papers recorded.",
      "",
      "## Approved Research",
      extraction.trim() || "No extracted research recorded.",
      "",
      "## Implementation Objective",
      "TBD",
      "",
      "## Interfaces And Data Contracts",
      "TBD",
      "",
      "## Algorithms And Methods To Implement",
      "TBD",
      "",
      "## Files And Modules To Change",
      "TBD",
      "",
      "## Verification Plan",
      "TBD",
      "",
      "## Risks And Constraints",
      "TBD",
      "",
      "## Implementation Steps",
      "TBD",
      ""
    ].join("\n");
  }

  private validateBlockReferences(state: PlannerState, ids: string[], ownId: string): string[] {
    return uniqueValues(ids)
      .map(normalizeId)
      .filter((id) => id !== ownId)
      .map((id) => {
        if (!state.blocks[id]) {
          throw new Error(`Unknown block reference: ${id}`);
        }
        return id;
      });
  }

  private requireBlock(state: PlannerState, blockId: string): BlockRecord {
    const id = normalizeId(blockId);
    const block = state.blocks[id];
    if (!block) {
      throw new Error(`Unknown block id: ${id}`);
    }

    return block;
  }

  private requirePaper(state: PlannerState, paperId: string): PaperRecord {
    const id = normalizeId(paperId);
    const paper = state.papers[id];
    if (!paper) {
      throw new Error(`Unknown paper id: ${id}`);
    }

    return paper;
  }

  private blocksDir(): string {
    return path.join(this.root, "blocks");
  }

  private papersDir(): string {
    return path.join(this.root, "papers");
  }

  private plannerDir(): string {
    return path.join(this.root, ".planner");
  }

  private statePath(): string {
    return path.join(this.plannerDir(), "state.json");
  }

  private async audit(event: string, data: Record<string, unknown>): Promise<void> {
    await fs.mkdir(path.join(this.plannerDir(), "logs"), { recursive: true });
    const line = JSON.stringify({ timestamp: nowIso(), event, data });
    await fs.appendFile(path.join(this.plannerDir(), "audit-log.jsonl"), `${line}\n`, "utf8");
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(filePath: string): Promise<string> {
  if (!(await exists(filePath))) {
    return "";
  }

  return fs.readFile(filePath, "utf8");
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function normalizeImplementationTarget(args: { language: string; framework: string }): ImplementationTarget {
  const language = args.language.trim();
  const framework = args.framework.trim();
  if (!language) {
    throw new Error("Implementation target language is required.");
  }
  if (!framework) {
    throw new Error("Implementation target framework is required.");
  }
  return { language, framework };
}

function requireImplementationTarget(state: PlannerState): ImplementationTarget {
  if (!state.implementation_target) {
    throw new Error("Project implementation target is not set. Set language and framework before creating specs or preparing implementation context.");
  }
  return state.implementation_target;
}

function implementationTargetMarkdown(target: ImplementationTarget): string {
  return [`Language: ${target.language}`, `Framework: ${target.framework}`].join("\n");
}

function ensureSpecImplementationTarget(markdown: string, target: ImplementationTarget): string {
  const targetSection = ["## Implementation Target", implementationTargetMarkdown(target), ""].join("\n");
  if (/^## Implementation Target\s*$/im.test(markdown)) {
    return markdown.replace(
      /^## Implementation Target\s*[\r\n]+(?:Language:\s*.*[\r\n]+)?(?:Framework:\s*.*[\r\n]+)?/im,
      targetSection
    );
  }

  const firstHeading = /^# .+$/m.exec(markdown);
  if (!firstHeading || firstHeading.index === undefined) {
    return `${targetSection}${markdown}`;
  }

  const insertAt = firstHeading.index + firstHeading[0].length;
  return `${markdown.slice(0, insertAt)}\n\n${targetSection}${markdown.slice(insertAt).replace(/^\s*/, "\n")}`;
}

function specHasImplementationTarget(spec: string, target: ImplementationTarget): boolean {
  const lines = spec.split(/\r?\n/);
  const sectionStart = lines.findIndex((line) => line.trim().toLowerCase() === "## implementation target");
  if (sectionStart < 0) {
    return false;
  }

  const sectionLines = [];
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }
    sectionLines.push(lines[index].trim());
  }

  const language = sectionLines.find((line) => line.toLowerCase().startsWith("language:"))?.slice("language:".length).trim();
  const framework = sectionLines.find((line) => line.toLowerCase().startsWith("framework:"))?.slice("framework:".length).trim();
  return language === target.language && framework === target.framework;
}

function nextId(prefix: "B" | "P", value: number): string {
  return `${prefix}-${String(value).padStart(3, "0")}`;
}

function crossRef(id: string, state?: PlannerState): string {
  const target = state?.blocks[id]?.dir;
  return target ? `[${id}](../../${target}/block.md)` : id;
}

function numericSuffix(id: string): number {
  const match = /(\d+)$/.exec(id);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function papersMarkdown(block: BlockRecord, papers: PaperRecord[]): string {
  const body = [
    `# Papers For ${block.id} ${block.title}`,
    "",
    ...(papers.length === 0
      ? ["No papers attached yet."]
      : papers.flatMap((paper) => [
          `## ${paper.id} ${paper.title}`,
          "",
          `Citation: ${paper.citation ?? "TBD"}`,
          `Discovery source: ${paper.discovery_source}`,
          `Source URL: ${paper.source_url ?? "N/A"}`,
          `Stored path: ${paper.stored_path ?? "Reference only"}`,
          `Source path: ${paper.source_path ?? "N/A"}`,
          `Authors: ${paper.authors?.join(", ") ?? "TBD"}`,
          `Year: ${paper.year ?? "TBD"}`,
          `Venue: ${paper.venue ?? "TBD"}`,
          `DOI: ${paper.doi ?? "N/A"}`,
          `arXiv: ${paper.arxiv_id ?? "N/A"}`,
          `Relevance score: ${paper.relevance_score ?? "N/A"}`,
          "",
          "### Abstract",
          paper.abstract ?? "TBD",
          "",
          "### Relevance Notes",
          paper.notes ?? "TBD",
          "",
          "### Relevant Sections",
          ...(paper.relevant_sections.length > 0 ? paper.relevant_sections.map((item) => `- ${item}`) : ["- TBD"]),
          ""
        ]))
  ].join("\n");

  return ensureTrailingNewline(body);
}

function researchExtractionTemplate(block: BlockRecord, state: PlannerState): string {
  const papers = block.paper_ids.map((paperId) => state.papers[paperId]).filter(Boolean);
  return [
    `# Extracted Research For ${block.id} ${block.title}`,
    "",
    "## Attached Papers",
    ...(papers.length > 0 ? papers.map((paper) => `- ${paper.id}: ${paper.title}`) : ["- None"]),
    "",
    "## Relevant Claims",
    "TBD",
    "",
    "## Methods To Use",
    "TBD",
    "",
    "## Algorithms / Equations",
    "TBD",
    "",
    "## Parameters / Thresholds",
    "TBD",
    "",
    "## Constraints",
    "TBD",
    "",
    "## Risks",
    "TBD",
    "",
    "## Conflicts Between Papers",
    "TBD",
    "",
    "## Implementation Guidance",
    "TBD",
    "",
    "## Evidence Map",
    "TBD",
    ""
  ].join("\n");
}

function inferPaperTitle(paperPath: string | undefined, id: string): string {
  if (!paperPath) {
    return id;
  }

  return path.basename(paperPath, path.extname(paperPath)).replace(/[-_]+/g, " ");
}

function graphMarkdown(graph: ReturnType<PlannerStore["buildGraph"]>): string {
  const lines = ["# Plan Graph", ""];

  for (const block of graph.blocks) {
    lines.push(`## ${block.id} ${block.title}`);
    lines.push(`Status: ${block.status}`);
    lines.push(`Depends on: ${block.depends_on.length > 0 ? block.depends_on.join(", ") : "none"}`);
    lines.push(`Related blocks: ${block.related_blocks.length > 0 ? block.related_blocks.join(", ") : "none"}`);
    lines.push(`Papers: ${block.paper_ids.length > 0 ? block.paper_ids.join(", ") : "none"}`);
    lines.push("");
  }

  lines.push("## Edges");
  if (graph.edges.length === 0) {
    lines.push("No graph edges recorded.");
  } else {
    for (const edge of graph.edges) {
      lines.push(`- ${edge.from} --${edge.type}--> ${edge.to}`);
    }
  }

  return ensureTrailingNewline(lines.join("\n"));
}

function linkAdjacentBlocks(records: BlockRecord[]): void {
  for (let index = 0; index < records.length; index += 1) {
    const related = [records[index - 1]?.id, records[index + 1]?.id].filter(Boolean) as string[];
    records[index].related_blocks = uniqueValues([...records[index].related_blocks, ...related]);
  }
}

function extractKeywords(value: string): string[] {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "each",
    "where",
    "must",
    "should",
    "system",
    "block",
    "entity",
    "entities"
  ]);

  const counts = new Map<string, number>();
  for (const match of value.toLowerCase().matchAll(/[a-z][a-z0-9-]{3,}/g)) {
    const word = match[0];
    if (stopWords.has(word)) {
      continue;
    }
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([word]) => word);
}
