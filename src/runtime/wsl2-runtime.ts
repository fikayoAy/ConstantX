import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import type { ArtifactResult, CreateJobInput, ExecResult, PatchResult, Runtime, RuntimeJob } from "./types.js";
import { collectArtifactFiles, collectGitPatch, copyProjectForJob } from "./runtime-utils.js";

export class Wsl2Runtime implements Runtime {
  readonly name = "wsl2" as const;

  async createJob(input: CreateJobInput): Promise<RuntimeJob> {
    if (!input.selectedDistro) {
      throw new Error("WSL2 runtime requires a selected WSL distro.");
    }
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
      selectedDistro: input.selectedDistro,
      timeoutSeconds: input.config.execution.timeoutSeconds
    };
  }

  async prepareWorkspace(job: RuntimeJob): Promise<void> {
    await fs.mkdir(job.ephemeralJobDir, { recursive: true });
    await copyProjectForJob(job.projectRoot, job.baselinePath, job.workspacePath);
  }

  async exec(job: RuntimeJob, command: string): Promise<ExecResult> {
    const cwd = await this.toWslPath(job.workspacePath, job.selectedDistro!);
    return runWslCommand(job.selectedDistro!, command, cwd, job.timeoutSeconds);
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

  private toWslPath(windowsPath: string, distro: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("wsl.exe", ["-d", distro, "--", "wslpath", "-a", windowsPath], { windowsHide: true }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve(stdout.trim());
      });
    });
  }
}

function runWslCommand(distro: string, command: string, cwd: string, timeoutSeconds: number): Promise<ExecResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = execFile("wsl.exe", ["-d", distro, "--cd", cwd, "--", "bash", "-lc", command], {
      windowsHide: true,
      timeout: timeoutSeconds * 1000,
      maxBuffer: 20 * 1024 * 1024
    }, (error, stdout, stderr) => {
      const timedOut = Boolean(error && "killed" in error && error.killed);
      const rawCode = (error as NodeJS.ErrnoException | null)?.code;
      const exitCode = typeof rawCode === "number" ? rawCode : error ? null : 0;
      resolve({ command, cwd, exitCode, stdout, stderr, durationMs: Date.now() - started, timedOut });
    });
    child.stdin?.end();
  });
}