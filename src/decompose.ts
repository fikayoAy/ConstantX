import type { PlanBlockInput } from "./types.js";
import { slugify, uniqueValues } from "./utils.js";

type HeadingSection = {
  title: string;
  content: string;
  startLine: number;
  endLine: number;
  sourceTitles?: string[];
  rawContent?: string;
};

export type DecomposeOptions = {
  maxBlocks?: number;
  preserveSections?: boolean;
};

const DEFAULT_MAX_BLOCKS = 12;

export function decomposePlanText(
  planText: string,
  planFile = "system-plan.md",
  options: DecomposeOptions = {}
): PlanBlockInput[] {
  const maxBlocks = options.maxBlocks ?? DEFAULT_MAX_BLOCKS;
  const sections = extractHeadingSections(planText);

  if (sections.length > 0) {
    const blockSections = options.preserveSections ? sections : mergeSections(sections, maxBlocks);
    const blocks = blockSections.map((item, index) => toBlock(item, index + 1, planFile));
    return addSequentialDependencies(blocks);
  }

  const paragraphSections = extractParagraphBlocks(planText);
  const blockSections = options.preserveSections ? paragraphSections : mergeSections(paragraphSections, maxBlocks);
  const blocks = blockSections.map((item, index) => toBlock(item, index + 1, planFile));
  return addSequentialDependencies(blocks);
}

function extractHeadingSections(planText: string): HeadingSection[] {
  const lines = planText.split(/\r?\n/);
  const headings: Array<{ title: string; line: number; level: number }> = [];

  lines.forEach((line, index) => {
    const match = /^(#{2,4})\s+(.+?)\s*$/.exec(line);
    if (match) {
      headings.push({
        level: match[1].length,
        title: match[2].trim(),
        line: index + 1
      });
    }
  });

  if (headings.length === 0) {
    return [];
  }

  const minLevel = Math.min(...headings.map((heading) => heading.level));
  const boundaryHeadings = headings.filter((heading) => heading.level === minLevel);

  return boundaryHeadings
    .map((heading, index) => {
      const next = boundaryHeadings[index + 1];
      const startLine = heading.line;
      const endLine = next ? next.line - 1 : lines.length;
      const content = lines.slice(startLine, endLine).join("\n").trim();
      return {
        title: heading.title,
        content,
        startLine,
        endLine
      };
    })
    .filter((section) => section.title.length > 0 && section.content.length > 0);
}

function extractParagraphBlocks(planText: string): HeadingSection[] {
  const chunks = planText
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  if (chunks.length === 0) {
    return [
      {
        title: "Plan Block",
        content: planText.trim() || "No plan content was provided.",
        startLine: 1,
        endLine: planText.split(/\r?\n/).length
      }
    ];
  }

  let lineCursor = 1;
  return chunks.map((chunk, index) => {
    const startLine = lineCursor;
    const lineCount = chunk.split(/\r?\n/).length;
    const title = inferTitle(chunk, index + 1);
    lineCursor += lineCount + 1;
    return {
      title,
      content: chunk,
      startLine,
      endLine: startLine + lineCount - 1
    };
  });
}

function toBlock(section: HeadingSection, ordinal: number, planFile: string): PlanBlockInput {
  const title = cleanTitle(section.title, ordinal);
  const sourceRef = `${planFile}:L${section.startLine}-L${section.endLine}`;
  const sourceTitles = section.sourceTitles ?? [section.title];
  const rawContent = section.rawContent ?? section.content;
  const responsibilities = deriveResponsibilities(sourceTitles, rawContent);

  return {
    title,
    purpose: derivePurpose(title, sourceTitles, rawContent),
    acceptance_criteria: deriveAcceptanceCriteria(title, sourceTitles, rawContent),
    responsibilities,
    inputs: deriveInputs(title, sourceTitles),
    outputs: deriveOutputs(title, sourceTitles),
    depends_on: [],
    related_blocks: [],
    research_questions: deriveResearchQuestions(title, sourceTitles),
    implementation_criteria: deriveImplementationCriteria(title, sourceTitles),
    source_plan_refs: [sourceRef],
    source_excerpt: buildSourceSummary(sourceTitles, sourceRef)
  };
}

function mergeSections(sections: HeadingSection[], maxBlocks: number): HeadingSection[] {
  if (maxBlocks < 1) {
    throw new Error("maxBlocks must be at least 1.");
  }

  if (sections.length <= maxBlocks) {
    return sections;
  }

  const groups = buildSemanticGroups(sections, maxBlocks);

  return groups.map((group, index) => {
    const first = group[0];
    const last = group[group.length - 1];
    const sourceTitles = group.map((item) => item.title);
    const title = inferGroupTitle(sourceTitles, index + 1);
    const content = buildSourceSummary(sourceTitles, `${first.startLine}-${last.endLine}`);

    return {
      title: cleanTitle(title, index + 1),
      content,
      startLine: first.startLine,
      endLine: last.endLine,
      sourceTitles,
      rawContent: group.map((item) => `## ${item.title}\n\n${item.content}`).join("\n\n")
    };
  });
}

function buildSemanticGroups(sections: HeadingSection[], maxBlocks: number): HeadingSection[][] {
  const thematic = buildThematicGroups(sections);
  if (thematic.length > 1) {
    return compactGroups(thematic, maxBlocks);
  }

  return equalGroups(sections, maxBlocks);
}

function buildThematicGroups(sections: HeadingSection[]): HeadingSection[][] {
  const groups: HeadingSection[][] = [];
  let current: HeadingSection[] = [];
  let currentTheme = -1;

  for (const section of sections) {
    const theme = classifySection(section);
    if (current.length > 0 && theme !== currentTheme) {
      groups.push(current);
      current = [];
    }
    current.push(section);
    currentTheme = theme;
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

function classifySection(section: HeadingSection): number {
  const text = `${section.title}\n${section.content}`.toLowerCase();
  const title = section.title.toLowerCase();

  if (matches(title, ["system goal", "input types", "scene problem", "whole-scene", "identification", "persistent identity"])) return 1;
  if (matches(title, ["entity problem", "hierarchical", "multi-factor", "partition"])) return 2;
  if (matches(title, ["rl-based", "iterative", "relation graph", "observed motion", "part-level motion", "camera motion"])) return 3;
  if (matches(title, ["canonical", "visible and invisible", "first-scene", "back-projection", "visibility accumulation", "latent diffusion", "full-body consistency"])) return 4;
  if (matches(title, ["entity vq", "scene memory", "identity, state", "memory hierarchy"])) return 5;
  if (matches(title, ["transferable skill", "skill as", "skill extraction", "skill vq", "skill compatibility", "skill transfer", "pose skills", "view skills"])) return 6;
  if (matches(title, ["texture", "rendering module", "spatially constrained rendering"])) return 7;
  if (matches(title, ["inference pipeline", "inference formula", "training", "objective", "required final outputs", "end-to-end architecture", "product behaviour", "mathematical summary", "one-line definition"])) return 8;
  if (matches(title, ["everything in the scene", "background", "entity context", "49.1 purpose"])) return 9;
  if (matches(title, ["spatial world state", "coordinate frames", "entity spatial state", "spatial support", "position, distance", "directional relations", "topological relations"])) return 10;
  if (matches(title, ["support and physical", "occlusion", "foreground", "surface, volume", "camera representation", "entity-to-camera"])) return 11;
  if (matches(title, ["persistent spatial", "spatial memory confidence", "spatial change", "spatial skills", "spatial learning", "updated final", "final spatial"])) return 12;

  if (matches(text, ["skill codebook", "pose", "articulation", "transfer"])) return 6;
  if (matches(text, ["camera", "occlusion", "spatial relation"])) return 11;
  if (matches(text, ["3d", "canonical", "visibility"])) return 4;
  return 0;
}

function matches(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function compactGroups(groups: HeadingSection[][], maxBlocks: number): HeadingSection[][] {
  const compacted = groups.filter((group) => group.length > 0);
  while (compacted.length > maxBlocks) {
    let mergeIndex = 0;
    let smallestCombinedSize = Number.POSITIVE_INFINITY;
    for (let index = 0; index < compacted.length - 1; index += 1) {
      const combinedSize = compacted[index].length + compacted[index + 1].length;
      if (combinedSize < smallestCombinedSize) {
        smallestCombinedSize = combinedSize;
        mergeIndex = index;
      }
    }
    compacted.splice(mergeIndex, 2, [...compacted[mergeIndex], ...compacted[mergeIndex + 1]]);
  }
  return compacted;
}

function equalGroups(sections: HeadingSection[], maxBlocks: number): HeadingSection[][] {
  const groups: HeadingSection[][] = [];
  const targetGroupCount = Math.min(maxBlocks, sections.length);
  const baseSize = Math.floor(sections.length / targetGroupCount);
  const remainder = sections.length % targetGroupCount;
  let cursor = 0;

  for (let groupIndex = 0; groupIndex < targetGroupCount; groupIndex += 1) {
    const size = baseSize + (groupIndex < remainder ? 1 : 0);
    groups.push(sections.slice(cursor, cursor + size));
    cursor += size;
  }

  return groups;
}

function inferGroupTitle(sourceTitles: string[], ordinal: number): string {
  const joined = sourceTitles.join(" | ").toLowerCase();
  if (matches(joined, ["system goal", "input types", "scene problem", "whole-scene", "identification"])) return "Scene Intake, Entity Discovery, and Problem Formulation";
  if (matches(joined, ["entity problem", "hierarchical", "multi-factor"])) return "Entity Representation and Multi-Factor Part Structure";
  if (matches(joined, ["rl-based", "relation graph", "observed motion", "part-level motion", "camera motion"])) return "Iterative Scene Solver, Relations, and Observed Dynamics";
  if (matches(joined, ["canonical", "back-projection", "visibility accumulation", "latent diffusion", "full-body"])) return "Canonical 3D Entity Memory and Visibility Completion";
  if (matches(joined, ["entity vq", "scene memory", "identity, state", "memory hierarchy"])) return "Entity Codebooks, Scene Memory, and State Separation";
  if (matches(joined, ["skill", "pose skills", "view skills"])) return "Skill Memory, Compatibility, and Transfer";
  if (matches(joined, ["texture", "rendering"])) return "Appearance Memory and Rendering";
  if (matches(joined, ["training", "objective", "outputs", "architecture", "product", "mathematical", "one-line"])) return "Training Objectives, Outputs, and End-to-End Product Contract";
  if (matches(joined, ["everything in the scene", "background", "entity context", "49.1 purpose"])) return "Scene Ontology and Entity Context Rules";
  if (matches(joined, ["spatial world", "coordinate frames", "spatial state", "spatial support", "nearness", "directional", "topological"])) return "Spatial World Model, Frames, and Geometric Relations";
  if (matches(joined, ["support and physical", "occlusion", "foreground", "surface", "camera representation", "entity-to-camera"])) return "Support, Occlusion, Camera, and Viewpoint Relations";
  if (matches(joined, ["persistent spatial", "spatial memory", "spatial change", "spatial skills", "spatially constrained", "final spatial"])) return "Persistent Spatial Memory, Spatial Skills, and Final Rendering Constraints";

  const first = stripOrdinal(sourceTitles[0]);
  const last = stripOrdinal(sourceTitles[sourceTitles.length - 1]);
  return sourceTitles.length === 1 ? first : `${first} / ${last || `Block ${ordinal}`}`;
}

function derivePurpose(title: string, sourceTitles: string[], content: string): string {
  const sentence = firstSentence(content);
  if (sentence && sentence.length < 220 && !sentence.startsWith("###")) {
    return sentence;
  }

  return `Define and implement the ${title.toLowerCase()} portion of the system using the referenced source-plan sections.`;
}

function deriveResponsibilities(sourceTitles: string[], content: string): string[] {
  const sectionResponsibilities = sourceTitles.map((sourceTitle) => `Cover source section: ${sourceTitle}`);
  const bullets = extractBullets(content)
    .filter((item) => !/^\(?\\?[a-z]_[a-z]/i.test(item))
    .filter((item) => item.length <= 140)
    .slice(0, 8);
  return [...sectionResponsibilities, ...bullets].slice(0, 14);
}

function deriveInputs(title: string, sourceTitles: string[]): string[] {
  const value = `${title} ${sourceTitles.join(" ")}`.toLowerCase();
  if (matches(value, ["scene intake", "input", "discovery"])) return ["Input image, video, drawing, multi-view observation, or user-provided mask"];
  if (matches(value, ["entity representation", "part"])) return ["Detected entity masks and scene/entity features"];
  if (matches(value, ["solver", "motion", "relation"])) return ["Scene/entity partitions, relation graph, temporal observations"];
  if (matches(value, ["canonical", "3d", "visibility"])) return ["Entity observations, camera state, canonical memory"];
  if (matches(value, ["skill"])) return ["Canonical entity memory, part graph, observed pose or articulation changes"];
  if (matches(value, ["rendering", "appearance"])) return ["Transformed entity state, texture/material memory, spatial world state"];
  return ["Outputs from prerequisite blocks and referenced source-plan sections"];
}

function deriveOutputs(title: string, sourceTitles: string[]): string[] {
  const value = `${title} ${sourceTitles.join(" ")}`.toLowerCase();
  if (matches(value, ["scene intake", "input", "discovery"])) return ["Scene decomposition, entity candidates, persistent identity records"];
  if (matches(value, ["entity representation", "part"])) return ["Entity factor representation and part decomposition records"];
  if (matches(value, ["solver", "motion", "relation"])) return ["Updated partitions, relation graph, observed dynamics state"];
  if (matches(value, ["canonical", "3d", "visibility"])) return ["Canonical 3D entity memory with visible/inferred regions and confidence"];
  if (matches(value, ["skill"])) return ["Skill records, compatibility metadata, transferable transformation representation"];
  if (matches(value, ["rendering", "appearance"])) return ["Rendered transformed entity/scene output and rendering constraints"];
  return ["Block-specific implementation artifacts defined by spec.md"];
}

function deriveResearchQuestions(title: string, sourceTitles: string[]): string[] {
  return [
    `Which primary papers directly support ${title}?`,
    `What methods, representations, losses, or constraints from those papers should be implemented for these source sections?`,
    `What failure modes or evaluation criteria from the papers apply to this block?`
  ];
}

function deriveAcceptanceCriteria(title: string, sourceTitles: string[], content: string): string[] {
  const candidates = uniqueValues([
    ...extractRequirementBullets(content),
    ...extractRequirementSentences(content)
  ]).filter((item) => item.length >= 18 && item.length <= 260);

  if (candidates.length > 0) {
    return candidates.slice(0, 10);
  }

  const sentence = firstSentence(content);
  if (sentence) {
    return [`Implement the source-plan requirement for ${title}: ${sentence}`];
  }

  return sourceTitles.slice(0, 6).map((sourceTitle) => `Implement the source-plan requirement named "${sourceTitle}" for ${title}.`);
}

function extractRequirementBullets(content: string): string[] {
  return extractBullets(content)
    .map(cleanCriterionText)
    .filter((item) => isRequirementLike(item) || item.length >= 30);
}

function extractRequirementSentences(content: string): string[] {
  return content
    .replace(/^#{1,6}\s+.+$/gm, "")
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map(cleanCriterionText)
    .filter((item) => isRequirementLike(item));
}

function cleanCriterionText(value: string): string {
  return value
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\s+/g, " ")
    .replace(/[`*_>#]+/g, "")
    .trim();
}

function isRequirementLike(value: string): boolean {
  return /\b(must|should|shall|required|requires|requirement|accepts?|inputs?|outputs?|produces?|returns?|supports?|handles?|tracks?|preserves?|stores?|uses?|allows?|prevents?|ensures?|verifies?|detects?|segments?|classifies?|predicts?|generates?|creates?|builds?|implements?)\b/i.test(value);
}

function deriveImplementationCriteria(title: string, sourceTitles: string[]): string[] {
  return [
    `${title} has a concrete spec.md derived from block.md, papers.md, and extracted-research.md.`,
    "Inputs and outputs are represented in normal source-code types or interfaces.",
    "Implementation preserves traceability to the referenced source-plan sections.",
    "Verification covers the block responsibilities and any dependency contracts."
  ];
}

function buildSourceSummary(sourceTitles: string[], sourceRef: string): string {
  return [
    `Source reference: ${sourceRef}`,
    "",
    "Included source sections:",
    ...sourceTitles.map((title) => `- ${title}`)
  ].join("\n");
}

function addSequentialDependencies(blocks: PlanBlockInput[]): PlanBlockInput[] {
  return blocks.map((block, index) => ({
    ...block,
    id: block.id ?? `B-${String(index + 1).padStart(3, "0")}`,
    depends_on: index === 0 ? [] : [`B-${String(index).padStart(3, "0")}`],
    related_blocks: [
      ...(index > 0 ? [`B-${String(index).padStart(3, "0")}`] : []),
      ...(index < blocks.length - 1 ? [`B-${String(index + 2).padStart(3, "0")}`] : [])
    ]
  }));
}

function stripOrdinal(title: string): string {
  return title.replace(/^\d+(?:\.\d+)*\.?\s+/, "").trim() || title;
}

function inferTitle(chunk: string, ordinal: number): string {
  const firstLine = chunk.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? `Plan Block ${ordinal}`;
  const withoutMarkdown = firstLine.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "");
  return cleanTitle(withoutMarkdown, ordinal);
}

function cleanTitle(title: string, ordinal: number): string {
  const compact = title.replace(/^#+\s*/, "").trim();
  if (compact.length <= 80) {
    return compact || `Plan Block ${ordinal}`;
  }

  const shortened = compact.slice(0, 77).replace(/\s+\S*$/, "");
  return shortened.length > 0 ? shortened : `Plan Block ${ordinal}`;
}

function extractBullets(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);
}

function firstSentence(content: string): string | undefined {
  const normalized = content
    .replace(/^#+\s+.+$/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return undefined;
  }

  const sentence = normalized.match(/^(.+?[.!?])\s/)?.[1] ?? normalized;
  return sentence.length > 240 ? `${sentence.slice(0, 237)}...` : sentence;
}

export function blockDirectoryName(id: string, title: string): string {
  return `${id}-${slugify(title)}`;
}




