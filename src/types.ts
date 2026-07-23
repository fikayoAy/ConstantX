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
  created_at: string;
  updated_at: string;
};

export type PaperRecord = {
  id: string;
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
  };
  implementation_target?: ImplementationTarget;
  blocks: Record<string, BlockRecord>;
  papers: Record<string, PaperRecord>;
};

export type BlockMarkdownMeta = BlockRecord & {
  source_excerpt?: string;
};

export type ToolResultData = Record<string, unknown> | unknown[] | null;
