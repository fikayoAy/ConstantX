import fs from "node:fs/promises";
import path from "node:path";
import { blockDirectoryName, decomposePlanText } from "./decompose.js";
import type { DecomposeOptions } from "./decompose.js";
import { parseMarkdownDocument, section, stringifyMarkdownDocument } from "./markdown.js";
import type {
  BlockMarkdownMeta,
  BlockRecord,
  BlockStatus,
  DesignDecisionStatus,
  DesignSessionRecord,
  DesignTurnRecord,
  DirectiveRecord,
  EvidenceType,
  ImplementationContextMode,
  ImplementationTarget,
  PaperRecord,
  PinKind,
  PinRecord,
  PlanBlockInput,
  PlannerState
} from "./types.js";
import { normalizeId, nowIso, relativeToProject, resolveProjectRoot, slugify, uniqueValues } from "./utils.js";

const STATE_VERSION = 1;
const IMPLEMENTABLE_STATUSES: BlockStatus[] = ["spec_approved", "ready_to_implement"];
const REIMPLEMENTABLE_STATUSES: BlockStatus[] = ["implemented", "verified"];
const COMPLETE_STATUSES: BlockStatus[] = ["implemented", "verified"];
const EVIDENCE_TYPES: EvidenceType[] = [
  "paper",
  "official_doc",
  "repository",
  "dataset",
  "benchmark",
  "model_card",
  "technical_report",
  "api_doc",
  "implementation_example",
  "user_file",
  "local_project_file",
  "other"
];

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
        papers: 0,
        directives: 0,
        pins: 0,
        designTurns: 0
      },
      blocks: {},
      papers: {},
      directives: {},
      pins: {},
      design_turns: {},
      design_sessions: {}
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

  async startProject(args: {
    planPath?: string;
    content?: string;
    planFileName?: string;
    title?: string;
    language: string;
    framework: string;
    maxBlocks?: number;
    preserveSections?: boolean;
  }): Promise<{
    projectPath: string;
    plan: Awaited<ReturnType<PlannerStore["ingestPlan"]>>;
    implementationTarget: ImplementationTarget;
    proposedBlocks: PlanBlockInput[];
    nextActions: string[];
  }> {
    await this.createProject(args.planFileName);
    const plan = await this.ingestPlan({
      content: args.content,
      planPath: args.planPath,
      planFileName: args.planFileName,
      title: args.title
    });
    const implementationTarget = await this.setImplementationTarget({
      language: args.language,
      framework: args.framework
    });
    const proposed = await this.decomposePlan({
      maxBlocks: args.maxBlocks,
      preserveSections: args.preserveSections,
      write: false
    });

    return {
      projectPath: this.root,
      plan,
      implementationTarget,
      proposedBlocks: proposed.blocks as PlanBlockInput[],
      nextActions: [
        "Review the proposed blocks.",
        "If accepted, run the Write Blocks command with the approved block list."
      ]
    };
  }

  async approvePlanBlocks(args: {
    blocks?: PlanBlockInput[];
    maxBlocks?: number;
    preserveSections?: boolean;
    replace?: boolean;
  }): Promise<{
    written: true;
    blocks: BlockRecord[];
    graph?: ReturnType<PlannerStore["buildGraph"]>;
    nextActions: string[];
  }> {
    const written = await this.decomposePlan({
      blocks: args.blocks,
      maxBlocks: args.maxBlocks,
      preserveSections: args.preserveSections,
      replace: args.replace,
      write: true
    });

    return {
      written: true,
      blocks: written.blocks as BlockRecord[],
      graph: written.graph,
      nextActions: [
        "Pick a block id and run the Gather Evidence command.",
        "Do not create specs or implement until evidence has been extracted and approved."
      ]
    };
  }

  async writeBlocks(args: {
    blocks?: PlanBlockInput[];
    maxBlocks?: number;
    preserveSections?: boolean;
    replace?: boolean;
  }): Promise<Awaited<ReturnType<PlannerStore["approvePlanBlocks"]>>> {
    return this.approvePlanBlocks(args);
  }

  async refine(args: {
    blockId?: string;
    userNote?: string;
    relatedPinIds?: string[];
    status?: DesignDecisionStatus;
    questions?: string[];
    finalize?: boolean;
    directives?: Array<{
      instruction: string;
      inferredImplementation: string;
      title?: string;
      sourceFile?: string;
      sourceEvidence?: string;
      approvedBy?: string;
    }>;
    approvedBy?: string;
    approvalNotes?: string;
    specMarkdown?: string;
    generatedBy?: string;
    focus?: string;
  }): Promise<unknown> {
    if (args.blockId && args.finalize) {
      return this.finalizeBlockDesignSession({
        blockId: args.blockId,
        directives: args.directives,
        approvedBy: args.approvedBy,
        approvalNotes: args.approvalNotes,
        specMarkdown: args.specMarkdown,
        generatedBy: args.generatedBy
      });
    }

    if (args.blockId && args.userNote) {
      const state = await this.loadState();
      if (!state.design_sessions[normalizeId(args.blockId)] || state.design_sessions[normalizeId(args.blockId)].status !== "active") {
        await this.startBlockDesignSession({ blockId: args.blockId, focus: args.focus });
      }
      return this.recordBlockDesignTurn({
        blockId: args.blockId,
        userNote: args.userNote,
        relatedPinIds: args.relatedPinIds,
        status: args.status,
        questions: args.questions
      });
    }

    if (args.blockId) {
      return this.startBlockDesignSession({ blockId: args.blockId, focus: args.focus });
    }

    return this.refineWrittenBlocks({
      userNote: args.userNote,
      approvedBy: args.approvedBy,
      focus: args.focus
    });
  }

  async implement(args: {
    blockId: string;
    specMarkdown?: string;
    generatedBy?: string;
    approvedBy?: string;
    approvalNotes?: string;
    mode?: ImplementationContextMode;
    implementationSummary?: string;
    changedFiles?: string[];
    implementationNotes?: string;
    verificationEvidence?: string;
    verifier?: string;
  }): Promise<unknown> {
    if (args.specMarkdown) {
      const state = await this.loadState();
      const block = this.requireBlock(state, args.blockId);
      if (block.status !== "research_approved" && block.status !== "spec_created" && block.status !== "spec_approved" && block.status !== "ready_to_implement") {
        await this.approveResearch({
          blockId: block.id,
          approvedBy: args.approvedBy,
          notes: args.approvalNotes
        });
      }
      const spec = await this.createSpec({
        blockId: args.blockId,
        specMarkdown: args.specMarkdown,
        generatedBy: args.generatedBy
      });
      return {
        ...spec,
        blockPackage: await this.readBlock(args.blockId),
        nextActions: [
          "Review spec.md.",
          "If accepted, run workflow.implement without specMarkdown to approve the spec, prepare strict implementation context, and proceed to implementation recording/verification."
        ]
      };
    }

    return this.implementAndVerifyBlock({
      blockId: args.blockId,
      approvedBy: args.approvedBy,
      approvalNotes: args.approvalNotes,
      mode: args.mode,
      implementationSummary: args.implementationSummary,
      changedFiles: args.changedFiles,
      implementationNotes: args.implementationNotes,
      verificationEvidence: args.verificationEvidence,
      verifier: args.verifier
    });
  }
  async gatherEvidence(args: {
    blockId: string;
    references?: Array<{
      title: string;
      sourceUrl?: string;
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
      evidenceType?: EvidenceType;
      paperPath?: string;
      content?: string;
      copy?: boolean;
    }>;
    extractionMarkdown?: string;
    generatedBy?: string;
  }): Promise<{
    block: BlockRecord;
    attachedEvidence: PaperRecord[];
    onlineResearch: ReturnType<PlannerStore["buildOnlineResearchPlan"]>;
    extraction?: Awaited<ReturnType<PlannerStore["extractResearch"]>>;
    blockPackage: Awaited<ReturnType<PlannerStore["readBlock"]>>;
    evidenceTypes: EvidenceType[];
    nextActions: string[];
  }> {
    const state = await this.loadState();
    const block = this.requireBlock(state, args.blockId);
    const onlineResearch = await this.prepareOnlineResearch(block.id);
    const attachedEvidence: PaperRecord[] = [];

    for (const reference of args.references ?? []) {
      attachedEvidence.push(await this.attachPaper({
        blockId: block.id,
        title: reference.title,
        sourceUrl: reference.sourceUrl,
        citation: reference.citation,
        authors: reference.authors,
        year: reference.year,
        venue: reference.venue,
        doi: reference.doi,
        arxivId: reference.arxivId,
        notes: reference.notes,
        abstract: reference.abstract,
        relevant_sections: reference.relevant_sections,
        relevanceScore: reference.relevanceScore,
        evidenceType: reference.evidenceType,
        paperPath: reference.paperPath,
        content: reference.content,
        copy: reference.copy,
        discoverySource: reference.sourceUrl && !reference.paperPath ? "codex_online" : "user_upload"
      }));
    }

    const extraction = args.extractionMarkdown
      ? await this.extractResearch({
          blockId: block.id,
          extractionMarkdown: args.extractionMarkdown,
          generatedBy: args.generatedBy
        })
      : undefined;

    return {
      block: this.requireBlock(await this.loadState(), block.id),
      attachedEvidence,
      onlineResearch,
      extraction,
      blockPackage: await this.readBlock(block.id),
      evidenceTypes: EVIDENCE_TYPES,
      nextActions: extraction
        ? [
            "Review extracted-research.md.",
            "If accepted, run Refine or Implement with specMarkdown to approve evidence and create spec.md."
          ]
        : [
            "Codex should search online using the returned queries and any user-provided files.",
            "Attach useful evidence references of any supported evidence type.",
            "Call this workflow stage again with extractionMarkdown containing only block-specific evidence.",
            "Do not approve research, create specs, or implement in this stage."
          ]
    };
  }

  async prepareBlockDesign(args: {
    blockId: string;
    annotations?: Array<{
      targetFile: string;
      annotationMarkdown: string;
      sourceFile?: string;
      annotationSource?: string;
      topic?: string;
      annotatedBy?: string;
      onlineResearchUsed?: boolean;
      sourceUrls?: string[];
    }>;
    directives?: Array<{
      instruction: string;
      inferredImplementation: string;
      title?: string;
      sourceFile?: string;
      sourceEvidence?: string;
      approvedBy?: string;
    }>;
    approvedBy?: string;
    approvalNotes?: string;
    specMarkdown?: string;
    generatedBy?: string;
  }): Promise<{
    block: BlockRecord;
    annotations: Array<Awaited<ReturnType<PlannerStore["annotateTargetFile"]>>>;
    directives: Array<Awaited<ReturnType<PlannerStore["addDirective"]>>>;
    researchApproval?: BlockRecord;
    spec?: Awaited<ReturnType<PlannerStore["createSpec"]>>;
    blockPackage: Awaited<ReturnType<PlannerStore["readBlock"]>>;
    nextActions: string[];
  }> {
    const state = await this.loadState();
    const block = this.requireBlock(state, args.blockId);
    const annotations = [];
    const directives = [];

    for (const annotation of args.annotations ?? []) {
      annotations.push(await this.annotateTargetFile({
        blockId: block.id,
        targetFile: annotation.targetFile,
        annotationMarkdown: annotation.annotationMarkdown,
        sourceFile: annotation.sourceFile,
        annotationSource: annotation.annotationSource,
        topic: annotation.topic,
        annotatedBy: annotation.annotatedBy,
        onlineResearchUsed: annotation.onlineResearchUsed,
        sourceUrls: annotation.sourceUrls
      }));
    }

    for (const directive of args.directives ?? []) {
      directives.push(await this.addDirective({
        blockId: block.id,
        instruction: directive.instruction,
        inferredImplementation: directive.inferredImplementation,
        title: directive.title,
        sourceFile: directive.sourceFile,
        sourceEvidence: directive.sourceEvidence,
        approvedBy: directive.approvedBy ?? args.approvedBy
      }));
    }

    const current = this.requireBlock(await this.loadState(), block.id);
    const researchApproval = current.status === "research_approved" || current.status === "spec_created" || current.status === "spec_approved" || current.status === "ready_to_implement"
      ? current
      : await this.approveResearch({ blockId: block.id, approvedBy: args.approvedBy, notes: args.approvalNotes });

    const spec = args.specMarkdown
      ? await this.createSpec({ blockId: block.id, specMarkdown: args.specMarkdown, generatedBy: args.generatedBy })
      : undefined;

    return {
      block: this.requireBlock(await this.loadState(), block.id),
      annotations,
      directives,
      researchApproval,
      spec,
      blockPackage: await this.readBlock(block.id),
      nextActions: spec
        ? [
            "Review spec.md.",
            "If accepted, run Implement And Verify Block."
          ]
        : [
            "Codex must create concrete specMarkdown from block.md, papers.md, extracted-research.md, directives.md, and the implementation target.",
            "Call this workflow stage again with specMarkdown.",
            "Do not approve spec or implement in this stage."
          ]
    };
  }

  async startBlockDesignSession(args: { blockId: string; focus?: string }): Promise<{
    block: BlockRecord;
    session: DesignSessionRecord;
    pins: PinRecord[];
    files: Record<string, string>;
    context: string;
    questions: string[];
    nextActions: string[];
  }> {
    const state = await this.loadState();
    const block = this.requireBlock(state, args.blockId);
    const blockMarkdown = await readIfExists(path.join(this.root, block.dir, "block.md"));
    const extraction = await readIfExists(path.join(this.root, block.dir, "extracted-research.md"));
    const papers = await readIfExists(path.join(this.root, block.dir, "papers.md"));
    const spec = await readIfExists(path.join(this.root, block.dir, "spec.md"));
    const directives = await readIfExists(path.join(this.root, block.dir, "directives.md"));
    const planText = await readIfExists(path.join(this.root, state.plan_file));
    const timestamp = nowIso();

    for (const pin of deriveDesignPins(block, {
      planFile: state.plan_file,
      planText,
      blockMarkdown,
      extraction,
      papers,
      spec,
      directives
    }, timestamp, nextPinNumberForBlock(state, block))) {
      if (!hasEquivalentPin(state, block, pin)) {
        state.pins[pin.id] = pin;
        state.counters.pins = Math.max(state.counters.pins, pin.pin_number);
      }
    }

    let session = state.design_sessions[block.id];
    const activePinIds = blockPinsForBlock(state, block).map((pin) => pin.id);
    if (!session) {
      session = {
        block_id: block.id,
        status: "active",
        pin_ids: activePinIds,
        turn_ids: [],
        created_at: timestamp,
        updated_at: timestamp
      };
      state.design_sessions[block.id] = session;
    } else {
      session.status = "active";
      session.updated_at = timestamp;
      delete session.finalized_at;
      delete session.finalized_by;
      session.pin_ids = uniqueValues([...session.pin_ids, ...activePinIds]);
    }

    const pins = session.pin_ids.map((id) => state.pins[id]).filter(Boolean);
    await this.writeDesignSessionFiles(block, state, session);
    await this.saveState(state);
    await this.audit("block_design_session_started", { blockId: block.id, focus: args.focus });

    return {
      block,
      session,
      pins,
      files: this.designSessionFiles(block),
      context: designSessionContext(block, pins, { blockMarkdown, extraction, papers, spec, directives, focus: args.focus }),
      questions: designSessionQuestions(pins, args.focus),
      nextActions: [
        "Discuss the block changes naturally with the user and compare every requested change against block.md, extracted-research.md, directives.md, and the generated pins.",
        "After each substantive user decision, Codex should call workflow.record_block_design_turn internally to append the decision to annotation-<BLOCK_ID>.md and design-session.md.",
        "When the user says the redesign is done, run workflow.refine with finalize=true, approved directives, and concrete specMarkdown. Do not approve spec or implement."
      ]
    };
  }

  async recordBlockDesignTurn(args: {
    blockId: string;
    userNote: string;
    agentInterpretation?: string;
    relatedPinIds?: string[];
    status?: DesignDecisionStatus;
    questions?: string[];
  }): Promise<{
    block: BlockRecord;
    session: DesignSessionRecord;
    turn: DesignTurnRecord;
    relatedPins: PinRecord[];
    annotationPath: string;
    designSessionPath: string;
    nextActions: string[];
  }> {
    const state = await this.loadState();
    const block = this.requireBlock(state, args.blockId);
    const session = state.design_sessions[block.id];
    if (!session || session.status !== "active") {
      throw new Error(`Start an active design session for ${block.id} before recording design turns.`);
    }
    if (args.userNote.trim().length < 20) {
      throw new Error("Design turn userNote must contain a concrete user decision, question, or requested change.");
    }

    const pins = session.pin_ids.map((id) => state.pins[id]).filter(Boolean);
    const relatedPinIds = normalizeDesignTurnPins(args.relatedPinIds, pins, args.userNote);
    const timestamp = nowIso();
    const turn: DesignTurnRecord = {
      id: nextId("T", ++state.counters.designTurns),
      block_id: block.id,
      user_note: args.userNote.trim(),
      agent_interpretation: args.agentInterpretation?.trim() || inferDesignTurnInterpretation(args.userNote, pins, relatedPinIds),
      related_pin_ids: relatedPinIds,
      status: args.status ?? "open",
      questions: uniqueValues(args.questions?.map((question) => question.trim()).filter(Boolean) ?? []),
      created_at: timestamp,
      updated_at: timestamp
    };

    state.design_turns[turn.id] = turn;
    session.turn_ids.push(turn.id);
    session.updated_at = timestamp;
    state.updated_at = timestamp;
    await this.writeDesignSessionFiles(block, state, session);
    await this.saveState(state);
    await this.audit("block_design_turn_recorded", { blockId: block.id, turnId: turn.id, status: turn.status });

    return {
      block,
      session,
      turn,
      relatedPins: relatedPinIds.map((id) => state.pins[id]).filter(Boolean),
      annotationPath: relativeToProject(this.root, path.join(this.root, block.dir, `annotation-${block.id}.md`)),
      designSessionPath: relativeToProject(this.root, path.join(this.root, block.dir, "design-session.md")),
      nextActions: turn.status === "approved"
        ? ["Continue the design conversation or finalize the session when all decisions are approved."]
        : ["Ask the user the unresolved questions, then record the next turn with candidate or approved status before finalizing."]
    };
  }

  async finalizeBlockDesignSession(args: {
    blockId: string;
    directives?: Array<{
      instruction: string;
      inferredImplementation: string;
      title?: string;
      sourceFile?: string;
      sourceEvidence?: string;
      approvedBy?: string;
    }>;
    approvedBy?: string;
    approvalNotes?: string;
    specMarkdown?: string;
    generatedBy?: string;
  }): Promise<{
    block: BlockRecord;
    session: DesignSessionRecord;
    approvedTurns: DesignTurnRecord[];
    directives: Array<Awaited<ReturnType<PlannerStore["addDirective"]>>>;
    researchApproval?: BlockRecord;
    spec?: Awaited<ReturnType<PlannerStore["createSpec"]>>;
    blockPackage: Awaited<ReturnType<PlannerStore["readBlock"]>>;
    nextActions: string[];
  }> {
    const state = await this.loadState();
    const block = this.requireBlock(state, args.blockId);
    const session = state.design_sessions[block.id];
    if (!session) {
      throw new Error(`No design session exists for ${block.id}. Start a block design session before finalizing.`);
    }

    const timestamp = nowIso();
    session.status = "finalized";
    session.finalized_at = timestamp;
    session.finalized_by = args.approvedBy?.trim() || "user";
    session.updated_at = timestamp;
    state.updated_at = timestamp;
    await this.writeDesignSessionFiles(block, state, session);
    await this.saveState(state);

    const storedDirectives = [];
    for (const directive of args.directives ?? []) {
      storedDirectives.push(await this.addDirective({
        blockId: block.id,
        instruction: directive.instruction,
        inferredImplementation: directive.inferredImplementation,
        title: directive.title,
        sourceFile: directive.sourceFile,
        sourceEvidence: directive.sourceEvidence,
        approvedBy: directive.approvedBy ?? args.approvedBy
      }));
    }

    const current = this.requireBlock(await this.loadState(), block.id);
    const researchApproval = current.status === "research_approved" || current.status === "spec_created" || current.status === "spec_approved" || current.status === "ready_to_implement"
      ? current
      : await this.approveResearch({ blockId: block.id, approvedBy: args.approvedBy, notes: args.approvalNotes });

    const spec = args.specMarkdown
      ? await this.createSpec({ blockId: block.id, specMarkdown: args.specMarkdown, generatedBy: args.generatedBy })
      : undefined;

    await this.audit("block_design_session_finalized", { blockId: block.id, generatedBy: args.generatedBy });

    return {
      block: this.requireBlock(await this.loadState(), block.id),
      session: (await this.loadState()).design_sessions[block.id],
      approvedTurns: this.designTurnsForBlock(await this.loadState(), block).filter((turn) => turn.status === "approved"),
      directives: storedDirectives,
      researchApproval,
      spec,
      blockPackage: await this.readBlock(block.id),
      nextActions: spec
        ? [
            "Review spec.md. It now includes finalized design-session decisions, approved implementation directives, research basis, and implementation target.",
            "Do not approve spec or implement until the user explicitly runs the implementation command."
          ]
        : [
            "Codex must convert approved design-session decisions into concrete directives and a complete specMarkdown value.",
            "Call workflow.refine with finalize=true, directives, and specMarkdown. Do not approve spec or implement."
          ]
    };
  }
  async implementAndVerifyBlock(args: {
    blockId: string;
    approvedBy?: string;
    approvalNotes?: string;
    mode?: ImplementationContextMode;
    implementationSummary?: string;
    changedFiles?: string[];
    implementationNotes?: string;
    verificationEvidence?: string;
    verifier?: string;
  }): Promise<{
    approvedSpec?: BlockRecord;
    implementationContext: Awaited<ReturnType<PlannerStore["prepareImplementationContext"]>>;
    implementation?: BlockRecord;
    verification?: BlockRecord;
    nextActions: string[];
  }> {
    const state = await this.loadState();
    const block = this.requireBlock(state, args.blockId);
    let approvedSpec: BlockRecord | undefined;

    if (block.status === "spec_created") {
      approvedSpec = await this.approveSpec({
        blockId: block.id,
        approvedBy: args.approvedBy,
        notes: args.approvalNotes
      });
    } else if (block.status === "spec_approved" || block.status === "ready_to_implement" || block.status === "implemented" || block.status === "verified") {
      approvedSpec = block;
    } else {
      throw new Error(`Block ${block.id} must have spec.md created before Implement And Verify. Current status: ${block.status}.`);
    }

    const implementationContext = await this.prepareImplementationContext(block.id, true, args.mode ?? "implement");

    if (!args.implementationSummary || !args.changedFiles || args.changedFiles.length === 0 || !args.verificationEvidence) {
      return {
        approvedSpec,
        implementationContext,
        nextActions: [
          "Codex must implement only this block from the strict implementation context.",
          "After code changes, run verification commands.",
          "Call this workflow stage again with implementationSummary, changedFiles, verificationEvidence, and verifier."
        ]
      };
    }

    const implementation = await this.recordImplementation({
      blockId: block.id,
      summary: args.implementationSummary,
      changedFiles: args.changedFiles,
      notes: args.implementationNotes
    });
    const verification = await this.verifyBlock({
      blockId: block.id,
      evidence: args.verificationEvidence,
      verifier: args.verifier
    });

    return {
      approvedSpec,
      implementationContext,
      implementation,
      verification,
      nextActions: [
        "Block implementation is recorded and verified.",
        "Move to the next unverified block or finalize the project when all blocks are complete."
      ]
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
    directives: string;
    pins: string;
    designSession: string;
    designAnnotation: string;
  }> {
    const state = await this.loadState();
    const record = this.requireBlock(state, blockId);
    return {
      record,
      block: await readIfExists(path.join(this.root, record.dir, "block.md")),
      papers: await readIfExists(path.join(this.root, record.dir, "papers.md")),
      extraction: await readIfExists(path.join(this.root, record.dir, "extracted-research.md")),
      spec: await readIfExists(path.join(this.root, record.dir, "spec.md")),
      implementation: await readIfExists(path.join(this.root, record.dir, "implementation.md")),
      directives: await readIfExists(path.join(this.root, record.dir, "directives.md")),
      pins: await readIfExists(path.join(this.root, record.dir, "pins.md")),
      designSession: await readIfExists(path.join(this.root, record.dir, "design-session.md")),
      designAnnotation: await readIfExists(path.join(this.root, record.dir, `annotation-${record.id}.md`))
    };
  }

  async prepareAnnotationContext(args: {
    blockId: string;
    targetFile: string;
    topic?: string;
    sourceFile?: string;
    annotationSource?: string;
    onlineResearch?: boolean;
  }): Promise<{
    block: BlockRecord;
    target: AnnotationTargetInfo;
    targetContent: string;
    blockPackage: {
      block: string;
      papers: string;
      extraction: string;
      spec: string;
      implementation: string;
    };
    onlineResearch: AnnotationResearchPlan;
    annotationTemplate: string;
    constraints: string[];
  }> {
    const state = await this.loadState();
    const block = this.requireBlock(state, args.blockId);
    const target = await this.resolveAnnotationTarget(state, block, args.targetFile);
    const blockPackage = await this.readBlock(block.id);
    const annotationRequest = normalizeAnnotationRequest(args);

    return {
      block,
      target,
      targetContent: await fs.readFile(target.absolutePath, "utf8"),
      blockPackage: {
        block: blockPackage.block,
        papers: blockPackage.papers,
        extraction: blockPackage.extraction,
        spec: blockPackage.spec,
        implementation: blockPackage.implementation
      },
      onlineResearch: buildAnnotationResearchPlan(block, target, annotationRequest, args.onlineResearch ?? false),
      annotationTemplate: annotationTemplate(annotationRequest),
      constraints: annotationConstraints()
    };
  }

  async annotateTargetFile(args: {
    blockId: string;
    targetFile: string;
    topic?: string;
    sourceFile?: string;
    annotationSource?: string;
    annotationMarkdown: string;
    annotatedBy?: string;
    onlineResearchUsed?: boolean;
    sourceUrls?: string[];
  }): Promise<{
    blockId: string;
    statusUnchanged: BlockStatus;
    target: AnnotationTargetInfo;
    topic: string;
    sourceFile?: string;
    annotationSource?: string;
    annotatedAt: string;
    bytesAppended: number;
    sourceUrls: string[];
    guarantees: string[];
  }> {
    const state = await this.loadState();
    const block = this.requireBlock(state, args.blockId);
    const statusBefore = block.status;
    const target = await this.resolveAnnotationTarget(state, block, args.targetFile);
    const annotationRequest = normalizeAnnotationRequest(args);
    validateAnnotationMarkdown(args.annotationMarkdown, annotationRequest);

    const timestamp = nowIso();
    const sourceUrls = uniqueValues(args.sourceUrls ?? []);
    const sourceExcerpt = annotationRequest.annotationSource
      ? ["Annotation source excerpt:", annotationRequest.annotationSource, ""]
      : [];
    const section = ensureTrailingNewline([
      "",
      `## Annotation: ${annotationRequest.subject}`,
      `Date: ${timestamp}`,
      `Block: ${block.id}`,
      `Target file: ${target.relativePath}`,
      `Target kind: ${target.kind}`,
      ...(annotationRequest.sourceFile ? [`Annotation source file: ${annotationRequest.sourceFile}`] : []),
      `Annotated by: ${args.annotatedBy?.trim() || "codex"}`,
      `Online research used: ${args.onlineResearchUsed ? "yes" : "no"}`,
      ...(sourceUrls.length > 0 ? [`Source URLs: ${sourceUrls.join(", ")}`] : []),
      "",
      ...sourceExcerpt,
      args.annotationMarkdown.trim(),
      ""
    ].join("\n"));

    await fs.appendFile(target.absolutePath, section, "utf8");

    return {
      blockId: block.id,
      statusUnchanged: statusBefore,
      target,
      topic: annotationRequest.subject,
      sourceFile: annotationRequest.sourceFile,
      annotationSource: annotationRequest.annotationSource,
      annotatedAt: timestamp,
      bytesAppended: Buffer.byteLength(section),
      sourceUrls,
      guarantees: [
        "Only the requested target file was appended.",
        "Block status was not changed.",
        "No research approval, spec creation, spec approval, implementation recording, verification, or code generation stage was advanced."
      ]
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
    evidenceType?: EvidenceType;
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
      evidence_type: args.evidenceType ?? inferEvidenceType(args),
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
    const evidencePin = makePinRecord({
      block,
      pinNumber: nextPinNumberForBlock(state, block),
      kind: "evidence",
      title: "Block-specific extracted evidence",
      sourceFile: "extracted-research.md",
      sourceRef: "Extracted evidence for active block",
      sourceExcerpt: markdown,
      checkpoint: "Use extracted-research.md only for evidence that is specific to this block and cite this pin in the spec when the evidence affects implementation.",
      relatedFiles: ["extracted-research.md", "papers.md", "spec.md"],
      timestamp: block.updated_at
    });
    if (!hasEquivalentPin(state, block, evidencePin) && !containsPlaceholderOnly(markdown)) {
      state.pins[evidencePin.id] = evidencePin;
      state.counters.pins = Math.max(state.counters.pins, evidencePin.pin_number);
      await fs.writeFile(path.join(this.root, block.dir, "pins.md"), pinsMarkdown(block, blockPinsForBlock(state, block)), "utf8");
    }
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

  async addDirective(args: {
    blockId: string;
    instruction: string;
    inferredImplementation: string;
    title?: string;
    sourceFile?: string;
    sourceEvidence?: string;
    approvedBy?: string;
  }): Promise<{
    block: BlockRecord;
    directive: DirectiveRecord;
    path: string;
    specInvalidated: boolean;
  }> {
    const state = await this.loadState();
    const block = this.requireBlock(state, args.blockId);
    const extraction = await readIfExists(path.join(this.root, block.dir, "extracted-research.md"));
    if (extraction.trim().length === 0) {
      throw new Error(`Block ${block.id} has no extracted-research.md content. Extract research before adding implementation directives.`);
    }

    validateDirectiveText(args.instruction, "instruction");
    validateDirectiveText(args.inferredImplementation, "inferred implementation");

    const id = nextId("D", ++state.counters.directives);
    const timestamp = nowIso();
    const directive: DirectiveRecord = {
      id,
      block_id: block.id,
      title: args.title?.trim() || inferDirectiveTitle(args.instruction, id),
      status: "approved",
      user_instruction: args.instruction.trim(),
      source_file: args.sourceFile?.trim() || "extracted-research.md",
      source_evidence: args.sourceEvidence?.trim(),
      inferred_implementation: args.inferredImplementation.trim(),
      approved_by: args.approvedBy?.trim() || "user",
      created_at: timestamp,
      updated_at: timestamp
    };

    state.directives[id] = directive;
    block.directive_ids = uniqueValues([...(block.directive_ids ?? []), id]);

    const specInvalidated = ["spec_created", "spec_approved", "ready_to_implement", "implementing", "implemented", "verified"].includes(block.status);
    if (specInvalidated) {
      block.status = "research_approved";
    }
    block.updated_at = timestamp;
    state.updated_at = timestamp;

    await this.writeDirectivesMarkdown(block, state);
    await this.writeBlockMarkdown(block, undefined, state);
    await this.saveState(state);
    await this.writeGraphFiles(state);
    await this.audit("directive_added", { blockId: block.id, directiveId: id, specInvalidated });

    return {
      block,
      directive,
      path: relativeToProject(this.root, path.join(this.root, block.dir, "directives.md")),
      specInvalidated
    };
  }

  async listDirectives(blockId?: string): Promise<DirectiveRecord[]> {
    const state = await this.loadState();
    if (blockId) {
      const block = this.requireBlock(state, blockId);
      return block.directive_ids.map((id) => state.directives[id]).filter(Boolean)
        .sort((a, b) => a.id.localeCompare(b.id));
    }

    return Object.values(state.directives).sort((a, b) => a.id.localeCompare(b.id));
  }

  async readDirectives(blockId: string): Promise<{
    record: BlockRecord;
    directives: DirectiveRecord[];
    markdown: string;
  }> {
    const state = await this.loadState();
    const block = this.requireBlock(state, blockId);
    return {
      record: block,
      directives: block.directive_ids.map((id) => state.directives[id]).filter(Boolean),
      markdown: await readIfExists(path.join(this.root, block.dir, "directives.md"))
    };
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
    if (!args.specMarkdown || args.specMarkdown.trim().length === 0) {
      throw new Error(concreteSpecRequiredMessage(block));
    }

    const specPath = path.join(this.root, block.dir, "spec.md");
    const markdown = ensureSpecImplementationTarget(args.specMarkdown, implementationTarget);
    validateConcreteSpec(markdown, block, implementationTarget, approvedDirectivesForBlock(state, block), pinsRequiredForSpec(state, block));
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
    validateConcreteSpec(spec, block, requireImplementationTarget(state), approvedDirectivesForBlock(state, block), pinsRequiredForSpec(state, block));

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
    const directives = await readIfExists(path.join(this.root, block.dir, "directives.md"));
    const pins = await readIfExists(path.join(this.root, block.dir, "pins.md"));
    const designSession = await readIfExists(path.join(this.root, block.dir, "design-session.md"));
    const designAnnotation = await readIfExists(path.join(this.root, block.dir, `annotation-${block.id}.md`));
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
      "## Approved Implementation Directives",
      directives.trim() || "No implementation directives recorded.",
      "",
      "## Pins And Checkpoints",
      pins.trim() || "No pins recorded.",
      "",
      "## Block Design Session",
      designSession.trim() || "No design session recorded.",
      "",
      "## Design Annotation Log",
      designAnnotation.trim() || "No design annotation log recorded.",
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
      const directives = await readIfExists(path.join(this.root, block.dir, "directives.md"));
      const implementation = await readIfExists(path.join(this.root, block.dir, "implementation.md"));
      sections.push([
        `## ${block.id} ${block.title}`,
        `Status: ${block.status}`,
        "",
        "### Spec",
        spec.trim() || "No spec recorded.",
        "",
        "### Implementation Directives",
        directives.trim() || "No directives recorded.",
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

    parsed.counters.directives ??= 0;
    parsed.counters.pins ??= 0;
    parsed.counters.designTurns ??= 0;
    parsed.directives ??= {};
    parsed.pins ??= {};
    parsed.design_turns ??= {};
    parsed.design_sessions ??= {};
    for (const block of Object.values(parsed.blocks)) {
      block.directive_ids ??= [];
    }
    for (const pin of Object.values(parsed.pins)) {
      const fallbackNumber = numericSuffix(pin.id) || 1;
      pin.pin_number ??= fallbackNumber;
      pin.label ??= `[${pin.pin_number}]`;
      pin.kind ??= inferPinKind(pin);
      pin.related_files ??= [];
    }
    parsed.counters.pins = Math.max(parsed.counters.pins, ...Object.values(parsed.pins).map((pin) => pin.pin_number ?? numericSuffix(pin.id)), 0);

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
      directive_ids: [],
      created_at: now,
      updated_at: now
    };

    state.blocks[id] = record;
    await fs.mkdir(path.join(this.root, record.dir), { recursive: true });
    for (const pin of initialPinsForBlock(record, block, state.plan_file, now)) {
      state.pins[pin.id] = pin;
      state.counters.pins = Math.max(state.counters.pins, pin.pin_number);
    }
    await this.writeBlockMarkdown(record, block, state);
    await fs.writeFile(path.join(this.root, record.dir, "pins.md"), pinsMarkdown(record, blockPinsForBlock(state, record)), "utf8");
    await fs.writeFile(path.join(this.root, record.dir, "papers.md"), papersMarkdown(record, []), "utf8");
    await fs.writeFile(path.join(this.root, record.dir, "extracted-research.md"), "", "utf8");
    await fs.writeFile(path.join(this.root, record.dir, "spec.md"), "", "utf8");
    await fs.writeFile(path.join(this.root, record.dir, "directives.md"), directivesMarkdown(record, []), "utf8");
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

    const pins = state ? blockPinsForBlock(state, record) : [];
    const body = existingBody ?? [
      `# ${record.title}`,
      "",
      section("Purpose", withPin(input?.purpose, pinForField(pins, "Purpose"))),
      section("Source From Original Plan", input?.source_excerpt),
      section("Responsibilities", withPins(input?.responsibilities, pinsForField(pins, "Responsibilities"))),
      section("Inputs", withPins(input?.inputs, pinsForField(pins, "Inputs"))),
      section("Outputs", withPins(input?.outputs, pinsForField(pins, "Outputs"))),
      section("Dependencies", record.depends_on.map((id) => crossRef(id, state))),
      section("Related Blocks", record.related_blocks.map((id) => crossRef(id, state))),
      section("Research Questions", withPins(input?.research_questions, pinsForField(pins, "Research Questions"))),
      section("Implementation Criteria", withPins(input?.implementation_criteria, pinsForField(pins, "Implementation Criteria"))),
      section("Open Questions", "TBD")
    ].join("\n");

    await fs.writeFile(blockPath, stringifyMarkdownDocument(meta, body), "utf8");
  }

  private async writePapersMarkdown(block: BlockRecord, state: PlannerState): Promise<void> {
    const papers = block.paper_ids.map((paperId) => this.requirePaper(state, paperId));
    await fs.writeFile(path.join(this.root, block.dir, "papers.md"), papersMarkdown(block, papers), "utf8");
  }
  private async writeDirectivesMarkdown(block: BlockRecord, state: PlannerState): Promise<void> {
    const directives = block.directive_ids.map((id) => state.directives[id]).filter(Boolean);
    await fs.writeFile(path.join(this.root, block.dir, "directives.md"), directivesMarkdown(block, directives), "utf8");
  }

  private async refineWrittenBlocks(args: { userNote?: string; approvedBy?: string; focus?: string }): Promise<{
    projectPath: string;
    blocks: Array<{ id: string; title: string; status: BlockStatus; pins: Array<{ label: string; title: string; source: string }> }>;
    refinementLog: string;
    context: string;
    questions: string[];
    nextActions: string[];
  }> {
    const state = await this.loadState();
    const blocks = Object.values(state.blocks).sort((a, b) => a.id.localeCompare(b.id));
    const planText = await readIfExists(path.join(this.root, state.plan_file));
    const timestamp = nowIso();
    const logPath = path.join(this.root, "block-refinement.md");

    if (!(await exists(logPath))) {
      await fs.writeFile(logPath, ensureTrailingNewline([
        "# Block Refinement Log",
        "",
        "This file records discussion about written block partitions, inline [n] references, missing plan coverage, overlap, dependencies, related blocks, removals, and boundary changes before evidence gathering.",
        ""
      ].join("\n")), "utf8");
    }

    if (args.userNote?.trim()) {
      await fs.appendFile(logPath, ensureTrailingNewline([
        `## Refinement Note ${timestamp}`,
        `Recorded by: ${args.approvedBy?.trim() || "codex"}`,
        args.focus ? `Focus: ${args.focus}` : "Focus: Written block partition refinement",
        "",
        args.userNote.trim(),
        ""
      ].join("\n")), "utf8");
    }

    const blockSummaries = [];
    for (const block of blocks) {
      const blockMarkdown = await readIfExists(path.join(this.root, block.dir, "block.md"));
      const pins = blockPinsForBlock(state, block);
      blockSummaries.push([
        `## ${block.id} ${block.title}`,
        `Status: ${block.status}`,
        "Pins:",
        ...(pins.length > 0 ? pins.map((pin) => `- ${pin.label}: ${pin.title} (${pin.source_file})`) : ["- No pins recorded."]),
        "Block excerpt:",
        compactExcerpt(blockMarkdown, 1000)
      ].join("\n"));
    }

    return {
      projectPath: this.root,
      blocks: blocks.map((block) => ({
        id: block.id,
        title: block.title,
        status: block.status,
        pins: blockPinsForBlock(state, block).map((pin) => ({
          label: pin.label,
          title: pin.title,
          source: `${pin.source_file}${pin.source_ref ? ` > ${pin.source_ref}` : ""}`
        }))
      })),
      refinementLog: relativeToProject(this.root, logPath),
      context: [
        "# Written Block Refinement Context",
        "",
        args.focus ? `Focus: ${args.focus}` : "Focus: review all written blocks against the original plan and existing pins.",
        "",
        "## Original Plan Excerpt",
        compactExcerpt(planText, 2000),
        "",
        ...blockSummaries
      ].join("\n\n"),
      questions: [
        "Do any block responsibilities overlap or belong in another block? Refer to block ids and [n] labels where possible.",
        "Is any original plan requirement missing from all block.md files or pins.md files?",
        "Should any dependency or related-block link be added, removed, or changed before evidence gathering?",
        "Should any pinned item be removed from a block because it is out of scope?"
      ],
      nextActions: [
        "Discuss block partition changes naturally and cite block ids plus [n] labels where useful.",
        "Codex should use planner.update_block for approved block.md/dependency edits and append additional project refinement notes through workflow.refine.",
        "Do not gather evidence, create specs, approve specs, or implement during refinement."
      ]
    };
  }
  private designSessionFiles(block: BlockRecord): Record<string, string> {
    return {
      pins: relativeToProject(this.root, path.join(this.root, block.dir, "pins.md")),
      designSession: relativeToProject(this.root, path.join(this.root, block.dir, "design-session.md")),
      annotation: relativeToProject(this.root, path.join(this.root, block.dir, `annotation-${block.id}.md`))
    };
  }

  private designTurnsForBlock(state: PlannerState, block: BlockRecord): DesignTurnRecord[] {
    const session = state.design_sessions[block.id];
    if (!session) {
      return [];
    }

    return session.turn_ids.map((id) => state.design_turns[id]).filter(Boolean);
  }

  private async writeDesignSessionFiles(block: BlockRecord, state: PlannerState, session: DesignSessionRecord): Promise<void> {
    const pins = session.pin_ids.map((id) => state.pins[id]).filter(Boolean);
    const turns = session.turn_ids.map((id) => state.design_turns[id]).filter(Boolean);
    await fs.writeFile(path.join(this.root, block.dir, "pins.md"), pinsMarkdown(block, pins), "utf8");
    await fs.writeFile(path.join(this.root, block.dir, "design-session.md"), designSessionMarkdown(block, session, pins, turns), "utf8");

    const annotationPath = path.join(this.root, block.dir, `annotation-${block.id}.md`);
    await fs.writeFile(annotationPath, designAnnotationMarkdown(block, session, pins, turns), "utf8");
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

  private async resolveAnnotationTarget(state: PlannerState, block: BlockRecord, targetFile: string): Promise<AnnotationTargetInfo> {
    const absolutePath = path.isAbsolute(targetFile)
      ? path.resolve(targetFile)
      : path.resolve(this.root, targetFile);
    const relative = path.relative(this.root, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Annotation target must stay inside the planner project: ${this.root}`);
    }

    const stat = await fs.stat(absolutePath).catch(() => undefined);
    if (!stat || !stat.isFile()) {
      throw new Error(`Annotation target does not exist or is not a file: ${relativeToProject(this.root, absolutePath)}`);
    }

    const relativePath = relativeToProject(this.root, absolutePath);
    if (relativePath.startsWith(".planner/")) {
      throw new Error("Annotation target must not be an internal .planner state or audit file.");
    }
    if (relativePath === "graph.md" || relativePath === state.plan_file || relativePath.startsWith("papers/")) {
      throw new Error("Annotation target must be a block package file or an implementation source file, not graph/system-plan/paper storage.");
    }

    const blockDir = path.resolve(this.root, block.dir);
    const blockRelative = path.relative(blockDir, absolutePath);
    const inRequestedBlockDir = !blockRelative.startsWith("..") && !path.isAbsolute(blockRelative);
    if (relativePath.startsWith("blocks/") && !inRequestedBlockDir) {
      throw new Error(`Annotation target belongs to a different block package than ${block.id}.`);
    }

    let kind: AnnotationTargetKind = "implementation_source";
    if (inRequestedBlockDir) {
      const name = path.basename(absolutePath);
      if (name === "block.md") {
        kind = "block_markdown";
      } else if (name === "extracted-research.md") {
        kind = "extracted_research";
      } else if (name === "spec.md") {
        kind = "spec";
      } else if (name === "implementation.md") {
        kind = "implementation_notes";
      } else {
        throw new Error("Files inside a block package may only be block.md, extracted-research.md, spec.md, or implementation.md annotation targets.");
      }
    }

    return {
      absolutePath,
      relativePath,
      kind,
      blockId: block.id,
      blockDir: block.dir
    };
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

type AnnotationTargetKind = "block_markdown" | "extracted_research" | "spec" | "implementation_notes" | "implementation_source";

type AnnotationTargetInfo = {
  absolutePath: string;
  relativePath: string;
  kind: AnnotationTargetKind;
  blockId: string;
  blockDir: string;
};

type AnnotationResearchPlan = {
  blockId: string;
  title: string;
  topic: string;
  sourceFile?: string;
  annotationSource?: string;
  targetFile: string;
  targetKind: AnnotationTargetKind;
  onlineResearchRequested: boolean;
  queries: string[];
  instructions: string[];
};

type AnnotationRequest = {
  subject: string;
  sourceFile?: string;
  annotationSource?: string;
};

function buildAnnotationResearchPlan(
  block: BlockRecord,
  target: AnnotationTargetInfo,
  request: AnnotationRequest,
  onlineResearchRequested: boolean
): AnnotationResearchPlan {
  const base = block.title.replace(/^\d+(?:\.\d+)*\.?\s+/, "");
  const sourceTerms = request.annotationSource ? compactAnnotationSource(request.annotationSource, 80) : request.subject;
  const queries = onlineResearchRequested
    ? uniqueValues([
        `${request.subject} primary paper`,
        `${request.subject} arXiv`,
        `${sourceTerms} primary source`,
        `${base} ${request.subject} implementation evidence`
      ]).filter((query) => query.trim().length > 8)
    : [];

  return {
    blockId: block.id,
    title: block.title,
    topic: request.subject,
    sourceFile: request.sourceFile,
    annotationSource: request.annotationSource,
    targetFile: target.relativePath,
    targetKind: target.kind,
    onlineResearchRequested,
    queries,
    instructions: [
      "Use this context only to annotate the requested target file.",
      "Base the annotation on the provided source file/excerpt from the block package or implementation record, not on a generic topic.",
      "If online research is requested, search primary sources before calling planner.annotate_target_file.",
      "Prefer arXiv, CVF/OpenAccess, ACL Anthology, IEEE, ACM, Springer, Nature, official project pages, or publisher pages.",
      "Do not approve research, create or replace spec.md, record implementation, verify blocks, or change block status.",
      "Let Codex choose the annotation structure from the selected source/excerpt; the annotation must remain concrete, traceable, implementation-relevant when applicable, and explicit about boundaries."
    ]
  };
}

function annotationTemplate(request: AnnotationRequest): string {
  return [
    `Write a concrete annotation based on: ${request.subject}`,
    ...(request.sourceFile ? [`Source file: ${request.sourceFile}`] : []),
    ...(request.annotationSource ? ["Source excerpt:", request.annotationSource] : []),
    "",
    "Codex may choose the structure. The annotation must preserve source/provenance, explain the concrete relevance to the target file or block, describe implementation impact if the source affects design, and state what workflow stages or files it must not change.",
    ""
  ].join("\n");
}

function annotationConstraints(): string[] {
  return [
    "Append only one dated annotation section to the target file.",
    "Do not modify .planner state, graph files, papers, specs, implementation records, or block status unless that exact file is the requested target.",
    "Do not use placeholders such as TBD, TODO, PLACEHOLDER, or angle-bracket template tokens.",
    "Do not approve research or spec, create spec.md, record implementation, verify blocks, or implement code.",
    "Keep annotation claims traceable to sources or to the approved local block artifacts."
  ];
}

function normalizeAnnotationRequest(args: { topic?: string; sourceFile?: string; annotationSource?: string }): AnnotationRequest {
  const topic = args.topic?.trim();
  const sourceFile = args.sourceFile?.trim();
  const annotationSource = args.annotationSource?.trim();
  if (!topic && !annotationSource) {
    throw new Error("Annotation requires either annotationSource from an existing artifact or a backward-compatible topic.");
  }
  if (annotationSource && annotationSource.length < 20) {
    throw new Error("annotationSource must include a concrete excerpt or instruction from block.md, extracted-research.md, spec.md, or implementation.md.");
  }

  return {
    subject: topic || inferAnnotationSubject(annotationSource ?? "", sourceFile),
    sourceFile,
    annotationSource
  };
}

function inferAnnotationSubject(annotationSource: string, sourceFile?: string): string {
  const cleaned = compactAnnotationSource(annotationSource, 96);
  if (cleaned.length > 0) {
    return cleaned;
  }
  return sourceFile ? `Evidence from ${path.basename(sourceFile)}` : "Selected project evidence";
}

function compactAnnotationSource(value: string, maxLength: number): string {
  const cleaned = value
    .replace(/[`*_>#\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength - 3).trim()}...`;
}

function validateAnnotationMarkdown(markdown: string, request: AnnotationRequest): void {
  const problems: string[] = [];
  const trimmed = markdown.trim();
  const lower = trimmed.toLowerCase();
  if (trimmed.length < 400) {
    problems.push("annotation is too short to be concrete");
  }

  const sourceTerms = importantAnnotationTerms(request.annotationSource ?? request.subject);
  const matchedTerms = sourceTerms.filter((term) => lower.includes(term.toLowerCase()));
  if (sourceTerms.length > 0 && matchedTerms.length < Math.min(2, sourceTerms.length)) {
    problems.push("annotation must explicitly discuss the selected annotation source/excerpt");
  }

  const placeholderPattern = new RegExp("(^|\\n)\\s*(?:[-*]\\s*)?(TBD|TODO|PLACEHOLDER|FILL ME|TO BE DECIDED|N/A\\s*FOR\\s*NOW)\\s*($|\\n)|:\\s*(TBD|TODO|PLACEHOLDER)\\s*($|\\n)|<(?:TOPIC|TARGET_FILE|BLOCK_ID|PROJECT_PATH|ANNOTATION|ANNOTATION_SOURCE_OR_EXCERPT|TODO|PLACEHOLDER|[^>]*HERE[^>]*)>", "i");
  if (placeholderPattern.test(trimmed)) {
    problems.push("annotation contains placeholder text");
  }

  if (!/\b(must not|do not|does not|non-scope|out of scope|boundary|boundaries)\b/i.test(trimmed)) {
    problems.push("annotation must state explicit boundaries or non-scope");
  }
  if (!/\b(source|sources|provenance|evidence|excerpt|citation|url|paper|local context|source lineage)\b/i.test(trimmed)) {
    problems.push("annotation must preserve source or provenance context");
  }
  if (!/\b(impact|relevance|affects|clarifies|changes|contract|interface|adapter|implementation|block|target file|design)\b/i.test(trimmed)) {
    problems.push("annotation must explain concrete relevance to the block, target file, or implementation design");
  }
  if (problems.length > 0) {
    throw new Error(`Annotation is not concrete enough: ${problems.join("; ")}.`);
  }
}

function importantAnnotationTerms(value: string): string[] {
  const stopWords = new Set([
    "from", "with", "that", "this", "should", "would", "could", "there", "their", "about", "into", "only", "must", "have", "been", "where", "when", "then", "than", "using", "evidence", "source", "selected", "implementation", "research"
  ]);
  const terms = value
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 4 && !stopWords.has(term.toLowerCase()));
  return uniqueValues(terms).slice(0, 6);
}

function validateDirectiveText(value: string, label: string): void {
  const trimmed = value.trim();
  if (trimmed.length < 40) {
    throw new Error(`Directive ${label} is too short to be implementation-relevant.`);
  }
  const placeholderPattern = /(^|\n)\s*(?:[-*]\s*)?(TBD|TODO|PLACEHOLDER|FILL ME|TO BE DECIDED|N\/A\s*FOR\s*NOW)\s*($|\n)|:\s*(TBD|TODO|PLACEHOLDER)\s*($|\n)|<(?:[^>]*HERE|TODO|PLACEHOLDER)[^>]*>/i;
  if (placeholderPattern.test(trimmed)) {
    throw new Error(`Directive ${label} contains placeholder text.`);
  }
}

function inferDirectiveTitle(instruction: string, id: string): string {
  const cleaned = instruction
    .replace(/\s+/g, " ")
    .replace(/[.#:;!?]+$/g, "")
    .trim();
  const words = cleaned.split(" ").slice(0, 10).join(" ");
  return words || `${id} Implementation Directive`;
}

function approvedDirectivesForBlock(state: PlannerState, block: BlockRecord): DirectiveRecord[] {
  return block.directive_ids
    .map((id) => state.directives[id])
    .filter((directive): directive is DirectiveRecord => Boolean(directive) && directive.status === "approved")
    .sort((a, b) => a.id.localeCompare(b.id));
}
function concreteSpecRequiredMessage(block: BlockRecord): string {
  return [
    `Block ${block.id} requires concrete specMarkdown.`,
    "planner.create_spec no longer creates placeholder spec.md files.",
    "Codex must first read block.md, papers.md, extracted-research.md, dependency summaries, and the implementation target, then pass a complete specMarkdown value.",
    "The spec must state exactly what to implement for this block, what not to implement, files/artifacts to create or modify, artifacts to remove or replace, data contracts, implementation steps, acceptance criteria, verification plan, traceability back to block/research evidence, and a Paper Model Fit And Adapter Map explaining how every attached paper maps to implementation behavior."
  ].join(" ");
}

function validateConcreteSpec(markdown: string, block: BlockRecord, target: ImplementationTarget, directives: DirectiveRecord[] = [], designPins: PinRecord[] = []): void {
  const problems: string[] = [];
  const trimmed = markdown.trim();
  if (trimmed.length < 1200) {
    problems.push("spec is too short to be an implementation-ready block specification");
  }
  if (!trimmed.includes(block.id)) {
    problems.push(`spec must explicitly reference block id ${block.id}`);
  }
  if (!specHasImplementationTarget(trimmed, target)) {
    problems.push(`spec must include Implementation Target language ${target.language} and framework ${target.framework}`);
  }

  const placeholderPattern = new RegExp("(^|\\n)\\s*(?:[-*]\\s*)?(TBD|TODO|PLACEHOLDER|FILL ME|TO BE DECIDED|N/A\\s*FOR\\s*NOW)\\s*($|\\n)|:\\s*(TBD|TODO|PLACEHOLDER)\\s*($|\\n)|<(?:BLOCK_ID|PROJECT_PATH|LANGUAGE|FRAMEWORK|TODO|PLACEHOLDER|[^>]*HERE[^>]*)>", "i");
  if (placeholderPattern.test(trimmed)) {
    problems.push("spec contains placeholder text such as TBD/TODO/<placeholder>");
  }

  const requiredSectionGroups: Array<{ label: string; patterns: RegExp[] }> = [
    { label: "block identity and source scope", patterns: [/^##\s+.*(block identity|scope|source)/im] },
    { label: "implementation target", patterns: [/^##\s+implementation target\s*$/im] },
    { label: "concrete implementation requirements", patterns: [/^##\s+.*(implementation requirements|implementation objective|what to implement|data model|processing flow)/im] },
    { label: "interfaces or data contracts", patterns: [/^##\s+.*(interfaces|data contracts|data model|output contract|api contract)/im] },
    { label: "files or artifacts to create or modify", patterns: [/^##\s+.*(files|artifacts).*(create|modify|change)/im, /^##\s+.*(create|modify|change).*(files|artifacts)/im] },
    { label: "artifacts to remove or replace", patterns: [/^##\s+.*(artifacts|files).*(remove|delete|replace|deprecate|cleanup)/im, /^##\s+.*(remove|delete|replace|deprecate|cleanup).*(artifacts|files)/im] },
    { label: "non-goals or boundaries", patterns: [/^##\s+.*(non-goals|boundaries|does not own|do not implement|out of scope)/im] },
    { label: "implementation steps", patterns: [/^##\s+.*implementation steps/im, /^##\s+.*processing flow/im] },
    { label: "acceptance criteria", patterns: [/^##\s+.*acceptance criteria/im] },
    { label: "verification plan", patterns: [/^##\s+.*verification/im] },
    { label: "paper model fit and adapter map", patterns: [/^##\s+.*paper.*model.*fit.*adapter.*map/im] },
    { label: "traceability to block and research", patterns: [/^##\s+.*(traceability|research basis|evidence map|source evidence)/im] }
  ];

  for (const group of requiredSectionGroups) {
    if (!group.patterns.some((pattern) => pattern.test(trimmed))) {
      problems.push(`missing required section: ${group.label}`);
    }
  }

  if (!/\b(remove|delete|replace|deprecate|cleanup|no artifacts to remove)\b/i.test(trimmed)) {
    problems.push("spec must explicitly say which stale/generated artifacts to remove/replace, or state that there are no artifacts to remove");
  }
  if (!/\b(do not implement|must not|out of scope|non-goal)\b/i.test(trimmed)) {
    problems.push("spec must include block boundaries/non-goals to prevent over-implementation");
  }
  if (!/\b(test|verify|verification|build|unit|integration)\b/i.test(trimmed)) {
    problems.push("spec must include concrete verification/test expectations");
  }
  if (!/\b(block\.md|extracted-research\.md|papers\.md|P-\d{3}|source plan|research)\b/i.test(trimmed)) {
    problems.push("spec must cite source block/research evidence, not just generic implementation text");
  }
  if (/^#\\s*(foundation|data pipeline|training|evaluation|deployment)\\s*$/im.test(trimmed)) {
    problems.push("spec appears to describe a generic phase instead of the exact block implementation");
  }

  validatePaperModelFitSection(trimmed, block, problems);
  validateApprovedDirectivesInSpec(trimmed, directives, problems);

  if (problems.length > 0) {
    throw new Error(`Spec for ${block.id} is not concrete enough: ${problems.join("; ")}.`);
  }
}

function validateDesignPinsInSpec(markdown: string, designPins: PinRecord[], problems: string[]): void {
  if (designPins.length === 0) {
    return;
  }

  const sectionText = extractTopLevelSection(markdown, /^##\s+.*(design session|design pins|source pins|checkpoints|annotation decisions)\s*$/i);
  if (!sectionText) {
    problems.push("spec must include a Design Session Pins / Checkpoints section when a block design session has been finalized");
    return;
  }

  for (const pin of designPins) {
    const pinMentioned = markdown.includes(pin.label) || markdown.includes(pin.id) || markdown.toLowerCase().includes(pin.title.toLowerCase());
    if (!pinMentioned) {
      problems.push(`spec must cite required pin ${pin.label} / ${pin.id} (${pin.title}) or explicitly state how it is unaffected`);
    }
  }

  if (!/\b(preserve|replace|reject|unaffected|implementation effect|scope|boundary|decision)\b/i.test(sectionText)) {
    problems.push("design session pin section must explain implementation effect, scope, or boundary decisions for the cited pins");
  }
}
function validateApprovedDirectivesInSpec(markdown: string, directives: DirectiveRecord[], problems: string[]): void {
  if (directives.length === 0) {
    return;
  }

  const sectionText = extractTopLevelSection(markdown, /^##\s+.*(user directives|implementation directives|directives.*overrides|approved directives)\s*$/i);
  if (!sectionText) {
    problems.push("spec must include a User Directives / Implementation Directives section when approved directives exist");
    return;
  }

  for (const directive of directives) {
    if (!sectionText.includes(directive.id) && !markdown.includes(directive.id)) {
      problems.push(`spec must cite approved directive ${directive.id}`);
    }
    const instructionKeywords = directive.user_instruction
      .toLowerCase()
      .match(/[a-z][a-z0-9-]{4,}/g)?.filter((word) => !["research", "evidence", "extracted", "implementation", "directive", "inputs", "model"].includes(word))
      .slice(0, 4) ?? [];
    const missingKeywords = instructionKeywords.filter((word) => !markdown.toLowerCase().includes(word));
    if (instructionKeywords.length > 0 && missingKeywords.length === instructionKeywords.length) {
      problems.push(`spec must reflect the concrete user instruction for ${directive.id}`);
    }
    if (!/\b(must|use|apply|preferred|selected|implementation effect|implementation direction|honor|obey)\b/i.test(sectionText)) {
      problems.push("directive section must state implementation effect, not only list directive ids");
    }
    if (!/\b(must not|do not|does not|boundary|boundaries|non-goal|out of scope|not final)\b/i.test(sectionText)) {
      problems.push("directive section must preserve directive boundaries/non-goals");
    }
  }
}
function validatePaperModelFitSection(markdown: string, block: BlockRecord, problems: string[]): void {
  const sectionText = extractTopLevelSection(markdown, /^##\s+.*paper.*model.*fit.*adapter.*map\s*$/i);
  if (!sectionText) {
    return;
  }

  const paperIds = block.paper_ids;
  if (paperIds.length === 0) {
    if (!/\b(no attached papers|no papers attached|no paper model adapters required)\b/i.test(sectionText)) {
      problems.push("paper model fit section must state that no paper model adapters are required when the block has no attached papers");
    }
    return;
  }

  for (const paperId of paperIds) {
    const paperEntry = extractPaperEntry(sectionText, paperId);
    if (!paperEntry) {
      problems.push(`paper model fit section must include an implementation mapping for ${paperId}`);
      continue;
    }

    const requiredEntryFields: Array<{ label: string; pattern: RegExp }> = [
      { label: "implementation role", pattern: /\b(implementation role|role)\b/i },
      { label: "processing step", pattern: /\b(processing step|fits in|used in|stage)\b/i },
      { label: "adapter or interface", pattern: /\b(adapter|interface)\b/i },
      { label: "consumed inputs", pattern: /\b(consumes|input|inputs|reads)\b/i },
      { label: "produced outputs", pattern: /\b(produces|output|outputs|emits|writes)\b/i },
      { label: "provenance", pattern: /\b(provenance|source_model|paper_support|producer_name)\b/i },
      { label: "confidence or uncertainty handling", pattern: /\b(confidence|uncertainty|score|ambiguity|risk)\b/i },
      { label: "boundaries", pattern: /\b(must not|mustn't|not used for|does not|boundary|boundaries|non-goal|non-goals)\b/i }
    ];

    for (const field of requiredEntryFields) {
      if (!field.pattern.test(paperEntry)) {
        problems.push(`${paperId} paper model fit entry is missing ${field.label}`);
      }
    }
  }
}

function extractTopLevelSection(markdown: string, headingPattern: RegExp): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (start < 0) {
    return undefined;
  }

  const sectionLines: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }
    sectionLines.push(lines[index]);
  }

  return sectionLines.join("\n").trim();
}

function extractPaperEntry(sectionText: string, paperId: string): string | undefined {
  const lines = sectionText.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`(^|\\b)${escapeRegExp(paperId)}(\\b|$)`).test(line));
  if (start < 0) {
    return undefined;
  }

  const entryLines: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    if (index > start && /^#{3,6}\s+/.test(lines[index]) && /\bP-\d{3}\b/.test(lines[index])) {
      break;
    }
    entryLines.push(lines[index]);
  }

  return entryLines.join("\n").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function nextId(prefix: "B" | "P" | "D" | "T", value: number): string {
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

function initialPinsForBlock(block: BlockRecord, input: PlanBlockInput, planFile: string, timestamp: string): PinRecord[] {
  const sourceBase = input.source_plan_refs?.join(", ") || input.title;
  const entries: Array<{ field: string; text: string; sourceRef: string; sourceExcerpt?: string }> = [];

  if (input.purpose?.trim()) {
    entries.push({
      field: "Purpose",
      text: input.purpose.trim(),
      sourceRef: `${sourceBase} > Purpose`,
      sourceExcerpt: input.source_excerpt
    });
  }

  for (const entry of indexedEntries("Responsibilities", input.responsibilities, sourceBase, input.source_excerpt)) {
    entries.push(entry);
  }
  for (const entry of indexedEntries("Inputs", input.inputs, sourceBase, input.source_excerpt)) {
    entries.push(entry);
  }
  for (const entry of indexedEntries("Outputs", input.outputs, sourceBase, input.source_excerpt)) {
    entries.push(entry);
  }
  for (const entry of indexedEntries("Research Questions", input.research_questions, sourceBase, input.source_excerpt)) {
    entries.push(entry);
  }
  for (const entry of indexedEntries("Implementation Criteria", input.implementation_criteria, sourceBase, input.source_excerpt)) {
    entries.push(entry);
  }

  if (entries.length === 0 && input.source_excerpt?.trim()) {
    entries.push({
      field: "Source From Original Plan",
      text: compactExcerpt(input.source_excerpt, 300),
      sourceRef: sourceBase,
      sourceExcerpt: input.source_excerpt
    });
  }

  return entries.map((entry, index) => makePinRecord({
    block,
    pinNumber: index + 1,
    kind: "plan",
    title: entry.text,
    sourceFile: planFile,
    sourceRef: entry.sourceRef,
    sourceExcerpt: entry.sourceExcerpt || entry.text,
    checkpoint: entry.text,
    relatedFiles: [planFile, "block.md"],
    timestamp
  }));
}

function indexedEntries(field: string, values: string[] | undefined, sourceBase: string, sourceExcerpt?: string): Array<{ field: string; text: string; sourceRef: string; sourceExcerpt?: string }> {
  return (values ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .map((text, index) => ({
      field,
      text,
      sourceRef: `${sourceBase} > ${field}[${index + 1}]`,
      sourceExcerpt
    }));
}

function makePinRecord(args: {
  block: BlockRecord;
  pinNumber: number;
  kind: PinKind;
  title: string;
  sourceFile: string;
  sourceRef?: string;
  sourceExcerpt?: string;
  checkpoint: string;
  relatedFiles: string[];
  timestamp: string;
}): PinRecord {
  return {
    id: pinId(args.block, args.pinNumber),
    block_id: args.block.id,
    pin_number: args.pinNumber,
    label: `[${args.pinNumber}]`,
    kind: args.kind,
    title: compactExcerpt(args.title, 160),
    source_file: args.sourceFile,
    source_ref: args.sourceRef,
    source_excerpt: args.sourceExcerpt ? compactExcerpt(args.sourceExcerpt, 900) : undefined,
    checkpoint: args.checkpoint,
    related_files: args.relatedFiles,
    created_at: args.timestamp,
    updated_at: args.timestamp
  };
}

function pinId(block: BlockRecord, pinNumber: number): string {
  return `PIN-${block.id.replace(/-/g, "")}-${String(pinNumber).padStart(3, "0")}`;
}

function blockPinsForBlock(state: PlannerState, block: BlockRecord): PinRecord[] {
  return Object.values(state.pins)
    .filter((pin) => pin.block_id === block.id)
    .sort((a, b) => (a.pin_number ?? numericSuffix(a.id)) - (b.pin_number ?? numericSuffix(b.id)) || a.id.localeCompare(b.id));
}

function nextPinNumberForBlock(state: PlannerState, block: BlockRecord): number {
  const pins = blockPinsForBlock(state, block);
  return pins.reduce((max, pin) => Math.max(max, pin.pin_number ?? numericSuffix(pin.id)), 0) + 1;
}

function pinForField(pins: PinRecord[], field: string): PinRecord | undefined {
  return pins.find((pin) => pin.kind === "plan" && pin.source_ref?.includes(`> ${field}`));
}

function pinsForField(pins: PinRecord[], field: string): PinRecord[] {
  return pins.filter((pin) => pin.kind === "plan" && pin.source_ref?.includes(`> ${field}`));
}

function withPin(value: string | undefined, pin: PinRecord | undefined): string | undefined {
  if (!value || !pin) {
    return value;
  }
  return hasPinLabel(value, pin.label) ? value : `${value.trim()} ${pin.label}`;
}

function withPins(values: string[] | undefined, pins: PinRecord[]): string[] | undefined {
  if (!values) {
    return values;
  }
  return values.map((value, index) => withPin(value, pins[index]) ?? value);
}

function hasPinLabel(value: string, label: string): boolean {
  return new RegExp(`${escapeRegExp(label)}\\s*$`).test(value.trim());
}

function containsPlaceholderOnly(markdown: string): boolean {
  const cleaned = markdown.replace(/^#.*$/gm, "").replace(/[-*\s]/g, "").trim().toLowerCase();
  return cleaned.length === 0 || /^(tbd|todo|placeholder|fillme|n\/a)+$/.test(cleaned);
}
function inferPinKind(pin: PinRecord): PinKind {
  const sourceFile = pin.source_file.toLowerCase();
  if (sourceFile.includes("extracted-research") || sourceFile.includes("papers")) {
    return "evidence";
  }
  if (sourceFile.includes("directive") || sourceFile.includes("annotation")) {
    return "directive";
  }
  if (sourceFile.includes("spec") || sourceFile.includes("design-session")) {
    return "design";
  }
  return "plan";
}
function hasEquivalentPin(state: PlannerState, block: BlockRecord, candidate: PinRecord): boolean {
  return blockPinsForBlock(state, block).some((pin) => {
    return pin.source_file === candidate.source_file && pin.source_ref === candidate.source_ref;
  });
}

function deriveDesignPins(
  block: BlockRecord,
  sources: {
    planFile: string;
    planText: string;
    blockMarkdown: string;
    extraction: string;
    papers: string;
    spec: string;
    directives: string;
  },
  timestamp: string,
  startPinNumber: number
): PinRecord[] {
  const candidates: Array<{
    kind: PinKind;
    title: string;
    source_file: string;
    source_ref: string;
    source_excerpt: string;
    checkpoint: string;
    related_files: string[];
  }> = [];

  if (sources.extraction.trim()) {
    candidates.push({
      kind: "evidence",
      title: "Block-specific extracted evidence",
      source_file: "extracted-research.md",
      source_ref: "Extracted evidence for active block",
      source_excerpt: compactExcerpt(sources.extraction),
      checkpoint: "Evidence in extracted-research.md may influence this block only when it is specific, cited, and preserved in spec traceability.",
      related_files: ["extracted-research.md", "papers.md", "spec.md"]
    });
  }

  if (sources.papers.trim() && !/No papers attached yet\./i.test(sources.papers)) {
    candidates.push({
      kind: "evidence",
      title: "Attached evidence references",
      source_file: "papers.md",
      source_ref: block.paper_ids.join(", ") || "Attached evidence records",
      source_excerpt: compactExcerpt(sources.papers),
      checkpoint: "Attached evidence must map to an implementation role, processing step, consumed/produced records, provenance, confidence handling, and boundaries before implementation.",
      related_files: ["papers.md", "extracted-research.md", "spec.md"]
    });
  }

  if (sources.directives.trim() && !/No implementation directives recorded yet\./i.test(sources.directives)) {
    candidates.push({
      kind: "directive",
      title: "Approved implementation directives",
      source_file: "directives.md",
      source_ref: block.directive_ids.join(", ") || "Approved directives",
      source_excerpt: compactExcerpt(sources.directives),
      checkpoint: "Approved directives override loose research interpretation and must be carried into spec.md without expanding scope beyond the block.",
      related_files: ["directives.md", "spec.md"]
    });
  }

  if (sources.spec.trim()) {
    candidates.push({
      kind: "design",
      title: "Existing spec scope",
      source_file: "spec.md",
      source_ref: "Existing implementation scope",
      source_excerpt: compactExcerpt(sources.spec),
      checkpoint: "Existing spec scope must be preserved, replaced, or explicitly rejected when redesign decisions change implementation direction.",
      related_files: ["spec.md", "implementation.md"]
    });
  }

  return candidates.map((candidate, index) => makePinRecord({
    block,
    pinNumber: startPinNumber + index,
    kind: candidate.kind,
    title: candidate.title,
    sourceFile: candidate.source_file,
    sourceRef: candidate.source_ref,
    sourceExcerpt: candidate.source_excerpt,
    checkpoint: candidate.checkpoint,
    relatedFiles: candidate.related_files,
    timestamp
  }));
}

function designSessionContext(
  block: BlockRecord,
  pins: PinRecord[],
  sources: { blockMarkdown: string; extraction: string; papers: string; spec: string; directives: string; focus?: string }
): string {
  return [
    `# Design Session Context For ${block.id} ${block.title}`,
    "",
    sources.focus ? `Focus: ${sources.focus}` : "Focus: Review any part of the block or evidence that may need redesign before spec generation.",
    "",
    "## Internal Pins",
    ...pins.map((pin) => `- ${pin.id}: ${pin.title} (${pin.source_file}) - ${pin.checkpoint}`),
    "",
    "## Block Snapshot",
    compactExcerpt(sources.blockMarkdown, 1800) || "No block.md content recorded.",
    "",
    "## Evidence Snapshot",
    compactExcerpt(sources.extraction, 1800) || "No extracted-research.md content recorded.",
    "",
    "## Directive Snapshot",
    compactExcerpt(sources.directives, 1200) || "No directives.md content recorded.",
    "",
    "## Existing Spec Snapshot",
    compactExcerpt(sources.spec, 1200) || "No spec.md content recorded."
  ].join("\n");
}

function designSessionQuestions(pins: PinRecord[], focus?: string): string[] {
  const firstPins = pins.slice(0, 4).map((pin) => `${pin.title}: ${pin.checkpoint}`);
  return uniqueValues([
    focus ? `Confirm whether the requested focus should replace existing behavior, add a new behavior, or only constrain the current spec: ${focus}` : "Which part of this block should be redesigned before the spec is generated?",
    ...firstPins.map((pin) => `Should this checkpoint change, stay as-is, or be marked out of scope? ${pin}`),
    "Are there user-provided files, code snippets, model choices, datasets, or constraints that must become approved implementation directives?"
  ]);
}

function normalizeDesignTurnPins(provided: string[] | undefined, pins: PinRecord[], note: string): string[] {
  const validIds = new Set(pins.map((pin) => pin.id));
  if (provided && provided.length > 0) {
    const ids = uniqueValues(provided.map((id) => id.trim()).filter(Boolean));
    const invalid = ids.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      throw new Error(`Unknown design pin id(s): ${invalid.join(", ")}.`);
    }
    return ids;
  }

  const noteWords = new Set(extractKeywords(note));
  const scored = pins
    .map((pin) => {
      const text = `${pin.title} ${pin.source_file} ${pin.source_ref ?? ""} ${pin.checkpoint} ${pin.source_excerpt ?? ""}`;
      const score = extractKeywords(text).filter((word) => noteWords.has(word)).length;
      return { pin, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.pin.id.localeCompare(b.pin.id));

  const inferred = scored.slice(0, 3).map((entry) => entry.pin.id);
  return inferred.length > 0 ? inferred : pins.slice(0, 2).map((pin) => pin.id);
}

function inferDesignTurnInterpretation(note: string, pins: PinRecord[], relatedPinIds: string[]): string {
  const related = relatedPinIds.map((id) => pins.find((pin) => pin.id === id)).filter(Boolean) as PinRecord[];
  const relatedTitles = related.map((pin) => pin.title).join(", ") || "the active block checkpoints";
  return `The user note should be evaluated against ${relatedTitles}. It may become an implementation directive only after the user confirms the decision and Codex checks it against block.md, extracted-research.md, directives.md, and the original plan pins. User note: ${note.trim()}`;
}

function pinsMarkdown(block: BlockRecord, pins: PinRecord[]): string {
  const body = [
    `# Pins For ${block.id} ${block.title}`,
    "",
    "Pins are stable checkpoints. The readable block text uses labels like [1], while this file stores what each label means and where it came from.",
    "",
    ...(pins.length === 0
      ? ["No pins recorded yet."]
      : pins.flatMap((pin) => [
          `## ${pin.label} ${pin.title}`,
          "",
          `Internal id: ${pin.id}`,
          `Kind: ${pin.kind}`,
          `Source file: ${pin.source_file}`,
          `Source reference: ${pin.source_ref ?? "Not recorded"}`,
          `Related files: ${pin.related_files.join(", ")}`,
          "",
          "Checkpoint:",
          pin.checkpoint,
          "",
          "Source excerpt:",
          pin.source_excerpt ?? "No source excerpt recorded.",
          ""
        ]))
  ].join("\n");
  return ensureTrailingNewline(body);
}

function designSessionMarkdown(block: BlockRecord, session: DesignSessionRecord, pins: PinRecord[], turns: DesignTurnRecord[]): string {
  const body = [
    `# Block Design Session For ${block.id} ${block.title}`,
    "",
    `Status: ${session.status}`,
    `Created at: ${session.created_at}`,
    `Updated at: ${session.updated_at}`,
    ...(session.finalized_at ? [`Finalized at: ${session.finalized_at}`, `Finalized by: ${session.finalized_by ?? "user"}`] : []),
    "",
    "## Internal Pins",
    ...(pins.length > 0 ? pins.map((pin) => `- ${pin.id}: ${pin.title} - ${pin.checkpoint}`) : ["- No pins generated."]),
    "",
    "## Conversation Decisions",
    ...(turns.length === 0
      ? ["No design turns recorded yet."]
      : turns.flatMap((turn) => [
          `### ${turn.id}`,
          `Status: ${turn.status}`,
          `Related pins: ${turn.related_pin_ids.length > 0 ? turn.related_pin_ids.join(", ") : "none"}`,
          `Created at: ${turn.created_at}`,
          "",
          "User note:",
          turn.user_note,
          "",
          "Agent interpretation:",
          turn.agent_interpretation,
          "",
          "Questions:",
          ...(turn.questions.length > 0 ? turn.questions.map((question) => `- ${question}`) : ["- None recorded"]),
          ""
        ])),
    "",
    "## Finalization Rule",
    "Only approved design decisions should be converted into implementation directives and spec.md. Finalizing this session must not approve spec.md or implement code."
  ].join("\n");
  return ensureTrailingNewline(body);
}

function designAnnotationMarkdown(block: BlockRecord, session: DesignSessionRecord, pins: PinRecord[], turns: DesignTurnRecord[]): string {
  return ensureTrailingNewline([
    `# Annotation Log For ${block.id} ${block.title}`,
    "",
    "This file captures user-supplied redesign discussion for the block. It is generated from the active design session so the user can talk naturally while Codex records concrete decisions against internal pins.",
    "",
    "## Active Pins",
    ...(pins.length > 0 ? pins.map((pin) => `- ${pin.id}: ${pin.title}`) : ["- No pins generated."]),
    "",
    "## Recorded Notes",
    ...(turns.length === 0
      ? ["No notes recorded yet."]
      : turns.flatMap((turn) => [
          `### ${turn.id} ${turn.status}`,
          `Related pins: ${turn.related_pin_ids.join(", ") || "none"}`,
          "",
          turn.user_note,
          "",
          "Interpretation:",
          turn.agent_interpretation,
          ""
        ])),
    "",
    `Session status: ${session.status}`
  ].join("\n"));
}

function pinsRequiredForSpec(state: PlannerState, block: BlockRecord): PinRecord[] {
  const finalized = finalizedDesignPinsForBlock(state, block);
  if (finalized.length > 0) {
    return finalized;
  }
  const planPins = blockPinsForBlock(state, block).filter((pin) => pin.kind === "plan");
  return planPins.slice(0, 1);
}
function finalizedDesignPinsForBlock(state: PlannerState, block: BlockRecord): PinRecord[] {
  const session = state.design_sessions[block.id];
  if (!session || session.status !== "finalized") {
    return [];
  }
  const approvedTurnPinIds = new Set(
    session.turn_ids
      .map((id) => state.design_turns[id])
      .filter((turn): turn is DesignTurnRecord => Boolean(turn) && turn.status === "approved")
      .flatMap((turn) => turn.related_pin_ids)
  );
  const ids = approvedTurnPinIds.size > 0 ? [...approvedTurnPinIds] : session.pin_ids;
  return ids.map((id) => state.pins[id]).filter(Boolean);
}

function findRelevantExcerpt(markdown: string, title: string): string {
  if (!markdown.trim()) {
    return "";
  }
  const escaped = escapeRegExp(title.trim());
  const match = new RegExp(`(^|\\n)#{1,4}\\s+.*${escaped}.*(?:\\n[\\s\\S]{0,1400})?`, "i").exec(markdown);
  return match?.[0] ?? markdown;
}

function compactExcerpt(markdown: string, maxLength = 900): string {
  const cleaned = markdown.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength).trim()}...`;
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

function directivesMarkdown(block: BlockRecord, directives: DirectiveRecord[]): string {
  const body = [
    `# Implementation Directives For ${block.id} ${block.title}`,
    "",
    "Implementation directives are approved user decisions that convert research evidence into implementation direction. They must be reflected in the next spec.md and included in strict implementation context.",
    "",
    ...(directives.length === 0
      ? ["No implementation directives recorded yet."]
      : directives.flatMap((directive) => [
          `## ${directive.id} ${directive.title}`,
          "",
          `Status: ${directive.status}`,
          `Approved by: ${directive.approved_by ?? "user"}`,
          `Created at: ${directive.created_at}`,
          `Updated at: ${directive.updated_at}`,
          `Source file: ${directive.source_file ?? "extracted-research.md"}`,
          ...(directive.source_evidence ? [`Source evidence: ${directive.source_evidence}`] : []),
          "",
          "### User Instruction",
          directive.user_instruction,
          "",
          "### Inferred Implementation Direction",
          directive.inferred_implementation,
          "",
          "### Spec Requirement",
          `The next spec.md must cite ${directive.id}, preserve the user instruction, and explain how this directive changes implementation behavior.`,
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

function inferEvidenceType(args: { evidenceType?: EvidenceType; sourceUrl?: string; paperPath?: string; content?: string; title?: string; venue?: string }): EvidenceType {
  if (args.evidenceType) {
    return args.evidenceType;
  }
  const text = `${args.title ?? ""} ${args.sourceUrl ?? ""} ${args.venue ?? ""}`.toLowerCase();
  if (text.includes("github.com") || text.includes("gitlab.com") || text.includes("repository") || text.includes("repo")) {
    return "repository";
  }
  if (text.includes("huggingface.co") || text.includes("model card") || text.includes("model-card")) {
    return "model_card";
  }
  if (text.includes("dataset") || text.includes("kaggle.com") || text.includes("paperswithcode.com/dataset")) {
    return "dataset";
  }
  if (text.includes("benchmark") || text.includes("leaderboard")) {
    return "benchmark";
  }
  if (text.includes("docs") || text.includes("documentation") || text.includes("api")) {
    return text.includes("api") ? "api_doc" : "official_doc";
  }
  if (args.paperPath || args.content) {
    return "user_file";
  }
  return "paper";
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































