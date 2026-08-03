export const BLOCK_STATUSES = [
  "created",
  "needs_research",
  "research_attached",
  "research_extracted",
  "research_approved",
  "spec_created",
  "spec_approved",
  "ready_to_implement",
  "implementing",
  "implemented",
  "verified"
] as const;

export type BlockStatus = (typeof BLOCK_STATUSES)[number];

export type PlanBlockInput = {
  id?: string;
  title: string;
  purpose?: string;
  responsibilities?: string[];
  inputs?: string[];
  outputs?: string[];
  depends_on?: string[];
  related_blocks?: string[];
  research_questions?: string[];
  implementation_criteria?: string[];
  source_plan_refs?: string[];
  source_excerpt?: string;
};

export type ImplementationTarget = {
  language: string;
  framework: string;
};

export type ImplementationContextMode = "implement" | "reimplement";

export type DirectiveStatus = "approved";

export type EvidenceType =
  | "paper"
  | "official_doc"
  | "repository"
  | "dataset"
  | "benchmark"
  | "model_card"
  | "technical_report"
  | "api_doc"
  | "implementation_example"
  | "user_file"
  | "local_project_file"
  | "other";

export type DesignSessionStatus = "active" | "finalized";

export type DesignDecisionStatus = "open" | "candidate" | "approved" | "rejected";

export type PinRecord = {
  id: string;
  block_id: string;
  title: string;
  source_file: string;
  source_ref?: string;
  source_excerpt?: string;
  checkpoint: string;
  related_files: string[];
  created_at: string;
  updated_at: string;
};

export type DesignTurnRecord = {
  id: string;
  block_id: string;
  user_note: string;
  agent_interpretation: string;
  related_pin_ids: string[];
  status: DesignDecisionStatus;
  questions: string[];
  created_at: string;
  updated_at: string;
};

export type DesignSessionRecord = {
  block_id: string;
  status: DesignSessionStatus;
  pin_ids: string[];
  turn_ids: string[];
  finalized_at?: string;
  finalized_by?: string;
  created_at: string;
  updated_at: string;
};

export type BlockRecord = {
  id: string;
  title: string;
  slug: string;
  dir: string;
  status: BlockStatus;
  depends_on: string[];
  related_blocks: string[];
  source_plan_refs: string[];
  paper_ids: string[];
  directive_ids: string[];
  created_at: string;
  updated_at: string;
};

export type DirectiveRecord = {
  id: string;
  block_id: string;
  title: string;
  status: DirectiveStatus;
  user_instruction: string;
  source_file?: string;
  source_evidence?: string;
  inferred_implementation: string;
  approved_by?: string;
  created_at: string;
  updated_at: string;
};
export type PaperRecord = {
  id: string;
  evidence_type?: EvidenceType;
  title: string;
  citation?: string;
  authors?: string[];
  year?: string;
  venue?: string;
  doi?: string;
  arxiv_id?: string;
  source_url?: string;
  source_path?: string;
  stored_path?: string;
  attached_to: string[];
  notes?: string;
  abstract?: string;
  relevant_sections: string[];
  discovery_source: "user_upload" | "codex_online" | "manual_reference";
  relevance_score?: number;
  created_at: string;
  updated_at: string;
};

export type PlannerState = {
  version: 1;
  plan_file: string;
  created_at: string;
  updated_at: string;
  counters: {
    blocks: number;
    papers: number;
    directives: number;
    pins: number;
    designTurns: number;
  };
  implementation_target?: ImplementationTarget;
  blocks: Record<string, BlockRecord>;
  papers: Record<string, PaperRecord>;
  directives: Record<string, DirectiveRecord>;
  pins: Record<string, PinRecord>;
  design_turns: Record<string, DesignTurnRecord>;
  design_sessions: Record<string, DesignSessionRecord>;
};

export type BlockMarkdownMeta = BlockRecord & {
  source_excerpt?: string;
};

export type ToolResultData = Record<string, unknown> | unknown[] | null;
