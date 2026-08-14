import type { ConstantXConfig, ConstantXRuntimeName } from "../config.js";

export type JobStatus = "created" | "prepared" | "running" | "waiting_for_agent" | "verified" | "failed" | "completed";
export type RunStatus = "created" | "running" | "waiting_for_agent" | "verified" | "failed" | "completed";

export type ExecResult = {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
};

export type PatchResult = {
  patch: string;
  changedFiles: string[];
  hasChanges: boolean;
};

export type ArtifactResult = {
  files: string[];
};

export type RuntimeJob = {
  runId: string;
  jobId: string;
  blockId: string;
  runtime: ConstantXRuntimeName;
  projectRoot: string;
  plannerRoot: string;
  persistentRunDir: string;
  ephemeralJobDir: string;
  workspacePath: string;
  baselinePath: string;
  selectedDistro?: string;
  timeoutSeconds: number;
};

export type CreateJobInput = {
  runId: string;
  jobId: string;
  blockId: string;
  projectRoot: string;
  plannerRoot: string;
  config: ConstantXConfig;
  selectedDistro?: string;
};

export type Runtime = {
  name: ConstantXRuntimeName;
  createJob(input: CreateJobInput): Promise<RuntimeJob>;
  prepareWorkspace(job: RuntimeJob): Promise<void>;
  exec(job: RuntimeJob, command: string): Promise<ExecResult>;
  collectPatch(job: RuntimeJob): Promise<PatchResult>;
  collectArtifacts(job: RuntimeJob): Promise<ArtifactResult>;
  destroy(job: RuntimeJob): Promise<void>;
};

export type RuntimeSelection = {
  runtime: ConstantXRuntimeName;
  selectedDistro?: string;
  detectedDistros: WslDistro[];
  fallbackRequired: boolean;
  fallbackReason?: string;
};

export type WslDistro = {
  name: string;
  state?: string;
  version?: number;
  isDefault: boolean;
};