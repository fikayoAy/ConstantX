import fs from "node:fs/promises";
import path from "node:path";
import type { ArtifactResult, CreateJobInput, ExecResult, PatchResult, Runtime, RuntimeJob } from "./types.js";
import { collectArtifactFiles, collectGitPatch, copyProjectForJob, runShellCommand } from "./runtime-utils.js";

export class LocalProjectRuntime implements Runtime {
  readonly name = "local-project" as const;

  async createJob(input: CreateJobInput): Promise<RuntimeJob> {
    const ephemeralJobDir = path.join(input.plannerRoot, "ephemeral", "jobs", input.jobId);
    return {
      runId: input.runId,
      jobId: input.jobId,
      blockId: input.blockId,
      runtime: this.name,
      projectRoot: input.projectRoot,
      plannerRoot: input.plannerRoot,
      persistentRunDir: path.join(input.plannerRoot, "persistent", "runs", input.runId),
      ephemeralJobDir,
      workspacePath: path.join(ephemeralJobDir, "repo"),
      baselinePath: path.join(ephemeralJobDir, "baseline"),
      timeoutSeconds: input.config.execution.timeoutSeconds
    };
  }

  async prepareWorkspace(job: RuntimeJob): Promise<void> {
    await fs.mkdir(job.ephemeralJobDir, { recursive: true });
    await copyProjectForJob(job.projectRoot, job.baselinePath, job.workspacePath);
  }

  async exec(job: RuntimeJob, command: string): Promise<ExecResult> {
    return runShellCommand(command, job.workspacePath, job.timeoutSeconds);
  }

  async collectPatch(job: RuntimeJob): Promise<PatchResult> {
    return collectGitPatch(job);
  }

  async collectArtifacts(job: RuntimeJob): Promise<ArtifactResult> {
    return { files: await collectArtifactFiles(job) };
  }

  async destroy(job: RuntimeJob): Promise<void> {
    await fs.rm(job.ephemeralJobDir, { recursive: true, force: true });
  }
}