import fs from "node:fs/promises";
import path from "node:path";
import type { ConstantXConfig } from "../config.js";
import { nowIso, relativeToProject } from "../utils.js";
import { LocalProjectRuntime } from "./local-process-runtime.js";
import type { ExecResult, JobStatus, RunStatus, Runtime, RuntimeJob, RuntimeSelection } from "./types.js";
import { detectWslDistros, selectWslDistro } from "./wsl-detection.js";
import { Wsl2Runtime } from "./wsl2-runtime.js";

export type RuntimeJobRunResult = {
  runId: string;
  jobId?: string;
  runtime: "wsl2" | "local-project";
  selectedDistro?: string;
  status: RunStatus | "waiting_for_fallback_approval";
  persistentRunDir?: string;
  patchPath?: string;
  artifactManifestPath?: string;
  changedFiles: string[];
  commandResults: ExecResult[];
  verificationPassed: boolean;
  fallbackPrompt?: string;
  failureReason?: string;
  cleanupEphemeral: boolean;
};

export type RunImplementationJobInput = {
  projectRoot: string;
  plannerRoot: string;
  blockId: string;
  implementationContext: string;
  config: ConstantXConfig;
  localProjectFallbackApproved?: boolean;
};

export async function runImplementationJob(input: RunImplementationJobInput): Promise<RuntimeJobRunResult> {
  const runId = nextRunId();
  const selection = await selectRuntime(input.config, input.localProjectFallbackApproved);
  if (selection.fallbackRequired) {
    const fallbackPrompt = [
      "ConstantX could not find a usable WSL2 distro.",
      "Local-project execution can continue, but it is less isolated and may mutate or depend on the user's local environment.",
      "Do you want to continue with local-project execution for this run?",
      `Reason: ${selection.fallbackReason ?? "No WSL2 distro was selected."}`
    ].join("\n");
    await appendJsonl(path.join(input.plannerRoot, "runs.jsonl"), {
      run_id: runId,
      block_id: input.blockId,
      runtime: "local-project",
      status: "waiting_for_fallback_approval",
      started_at: nowIso(),
      fallback_reason: selection.fallbackReason,
      detected_distros: selection.detectedDistros
    });
    return {
      runId,
      runtime: "local-project",
      status: "waiting_for_fallback_approval",
      changedFiles: [],
      commandResults: [],
      verificationPassed: false,
      fallbackPrompt,
      cleanupEphemeral: input.config.execution.cleanupEphemeral
    };
  }

  const jobId = nextJobId();
  const runtime = makeRuntime(selection.runtime);
  const job = await runtime.createJob({
    runId,
    jobId,
    blockId: input.blockId,
    projectRoot: input.projectRoot,
    plannerRoot: input.plannerRoot,
    config: input.config,
    selectedDistro: selection.selectedDistro
  });

  await withProjectLock(input.plannerRoot, input.blockId, async () => {
    await initializeRun(job, input.implementationContext, selection);
  });

  const commandResults: ExecResult[] = [];
  let status: RunStatus = "running";
  let failureReason: string | undefined;
  let verificationPassed = false;
  let changedFiles: string[] = [];
  let patchPath: string | undefined;
  let artifactManifestPath: string | undefined;

  try {
    await updateJob(job, { status: "prepared" });
    await runtime.prepareWorkspace(job);

    if (input.config.execution.implementationCommands.length === 0) {
      status = "waiting_for_agent";
      await updateJob(job, { status: "waiting_for_agent", failure_reason: "No execution.implementationCommands configured; the calling agent must implement from the returned strict context." });
    } else {
      for (const command of input.config.execution.implementationCommands) {
        const result = await runtime.exec(job, command);
        commandResults.push(result);
        await saveCommandLog(job, result, `implementation-${commandResults.length}.log`);
        if (result.exitCode !== 0) {
          status = "failed";
          failureReason = `Implementation command failed: ${command}`;
          break;
        }
      }

      if (!failureReason) {
        const verificationResults: ExecResult[] = [];
        for (const command of input.config.verification.commands) {
          const result = await runtime.exec(job, command);
          commandResults.push(result);
          verificationResults.push(result);
          await saveCommandLog(job, result, `verify-${verificationResults.length}.log`);
          if (result.exitCode !== 0) {
            status = "failed";
            failureReason = `Verification command failed: ${command}`;
            break;
          }
        }
        verificationPassed = input.config.verification.commands.length > 0 && verificationResults.every((result) => result.exitCode === 0);
      }

      const patch = await runtime.collectPatch(job);
      changedFiles = patch.changedFiles;
      patchPath = await savePatch(job, patch.patch);
      const artifacts = await runtime.collectArtifacts(job);
      artifactManifestPath = await saveArtifactManifest(job, artifacts.files);
      if (!failureReason) status = verificationPassed || input.config.verification.commands.length === 0 ? "completed" : "failed";
      if (!failureReason && input.config.verification.commands.length === 0) failureReason = "No verification.commands configured; runtime finished but block cannot be verified automatically.";
    }
  } catch (error) {
    status = "failed";
    failureReason = error instanceof Error ? error.message : String(error);
  } finally {
    await finishRun(job, status, commandResults, changedFiles, verificationPassed, failureReason, patchPath, artifactManifestPath);
    if (input.config.execution.cleanupEphemeral) {
      await runtime.destroy(job);
    }
  }

  return {
    runId,
    jobId,
    runtime: job.runtime,
    selectedDistro: job.selectedDistro,
    status,
    persistentRunDir: relativeToProject(input.projectRoot, job.persistentRunDir),
    patchPath: patchPath ? relativeToProject(input.projectRoot, patchPath) : undefined,
    artifactManifestPath: artifactManifestPath ? relativeToProject(input.projectRoot, artifactManifestPath) : undefined,
    changedFiles,
    commandResults,
    verificationPassed,
    failureReason,
    cleanupEphemeral: input.config.execution.cleanupEphemeral
  };
}

async function selectRuntime(config: ConstantXConfig, localFallbackApproved?: boolean): Promise<RuntimeSelection> {
  if (config.execution.runtime === "local-project") {
    if (!config.execution.localProjectFallbackApproved && !localFallbackApproved) {
      return { runtime: "local-project", detectedDistros: [], fallbackRequired: true, fallbackReason: "Configured runtime is local-project but fallback was not explicitly approved." };
    }
    return { runtime: "local-project", detectedDistros: [], fallbackRequired: false };
  }

  const detectedDistros = await detectWslDistros();
  const selected = selectWslDistro(detectedDistros, config.execution.wslDistro);
  if (!selected) {
    if (config.execution.localProjectFallbackApproved || localFallbackApproved) {
      return { runtime: "local-project", detectedDistros, fallbackRequired: false, fallbackReason: "No WSL distro detected; explicit local-project fallback approved." };
    }
    return { runtime: "local-project", detectedDistros, fallbackRequired: true, fallbackReason: "No WSL distro detected." };
  }
  if (selected.version && selected.version !== 2) {
    if (config.execution.localProjectFallbackApproved || localFallbackApproved) {
      return { runtime: "local-project", detectedDistros, fallbackRequired: false, fallbackReason: `Selected distro ${selected.name} is WSL${selected.version}, not WSL2.` };
    }
    return { runtime: "local-project", detectedDistros, fallbackRequired: true, fallbackReason: `Selected distro ${selected.name} is WSL${selected.version}, not WSL2.` };
  }
  return { runtime: "wsl2", selectedDistro: selected.name, detectedDistros, fallbackRequired: false };
}

function makeRuntime(runtime: "wsl2" | "local-project"): Runtime {
  return runtime === "wsl2" ? new Wsl2Runtime() : new LocalProjectRuntime();
}

async function initializeRun(job: RuntimeJob, implementationContext: string, selection: RuntimeSelection): Promise<void> {
  await fs.mkdir(path.join(job.persistentRunDir, "logs"), { recursive: true });
  await fs.mkdir(path.join(job.persistentRunDir, "patches"), { recursive: true });
  await fs.mkdir(path.join(job.persistentRunDir, "artifacts"), { recursive: true });
  await fs.writeFile(path.join(job.persistentRunDir, "implementation-context.md"), implementationContext, "utf8");
  const run = { run_id: job.runId, job_id: job.jobId, block_id: job.blockId, runtime: job.runtime, selected_distro: job.selectedDistro, status: "created", started_at: nowIso(), detected_distros: selection.detectedDistros };
  const jobRecord = { run_id: job.runId, job_id: job.jobId, block_id: job.blockId, runtime: job.runtime, status: "created", started_at: nowIso(), workspace: job.workspacePath };
  await fs.writeFile(path.join(job.persistentRunDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(job.persistentRunDir, "job.json"), `${JSON.stringify(jobRecord, null, 2)}\n`, "utf8");
  await appendJsonl(path.join(job.plannerRoot, "runs.jsonl"), run);
  await appendJsonl(path.join(job.plannerRoot, "jobs.jsonl"), jobRecord);
}

async function updateJob(job: RuntimeJob, patch: { status: JobStatus; failure_reason?: string }): Promise<void> {
  const jobPath = path.join(job.persistentRunDir, "job.json");
  const current = JSON.parse(await fs.readFile(jobPath, "utf8")) as Record<string, unknown>;
  const next = { ...current, ...patch, updated_at: nowIso() };
  await fs.writeFile(jobPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await appendJsonl(path.join(job.plannerRoot, "jobs.jsonl"), next);
}

async function finishRun(job: RuntimeJob, status: RunStatus, commandResults: ExecResult[], changedFiles: string[], verificationPassed: boolean, failureReason?: string, patchPath?: string, artifactManifestPath?: string): Promise<void> {
  const runPath = path.join(job.persistentRunDir, "run.json");
  const current = JSON.parse(await fs.readFile(runPath, "utf8")) as Record<string, unknown>;
  const next = { ...current, status, finished_at: nowIso(), commands_run: commandResults.map((result) => ({ command: result.command, exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut })), changed_files: changedFiles, patch_path: patchPath, artifact_manifest_path: artifactManifestPath, verification_result: verificationPassed ? "passed" : "not_verified", failure_reason: failureReason };
  await fs.writeFile(runPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(job.persistentRunDir, "test-results.json"), `${JSON.stringify(commandResults, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(job.persistentRunDir, "verification.md"), verificationMarkdown(commandResults, verificationPassed, failureReason), "utf8");
  await appendJsonl(path.join(job.plannerRoot, "runs.jsonl"), next);
  await updateJob(job, { status: status === "completed" ? "completed" : status === "failed" ? "failed" : status === "verified" ? "verified" : "running", failure_reason: failureReason });
}

async function saveCommandLog(job: RuntimeJob, result: ExecResult, name: string): Promise<void> {
  const log = [`$ ${result.command}`, `cwd: ${result.cwd}`, `exitCode: ${result.exitCode}`, `durationMs: ${result.durationMs}`, "", "## stdout", result.stdout, "", "## stderr", result.stderr].join("\n");
  await fs.writeFile(path.join(job.persistentRunDir, "logs", name), log, "utf8");
}

async function savePatch(job: RuntimeJob, patch: string): Promise<string> {
  const patchPath = path.join(job.persistentRunDir, "patches", "final.patch");
  await fs.writeFile(patchPath, patch, "utf8");
  return patchPath;
}

async function saveArtifactManifest(job: RuntimeJob, files: string[]): Promise<string> {
  const manifestPath = path.join(job.persistentRunDir, "artifacts", "manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify({ files }, null, 2)}\n`, "utf8");
  return manifestPath;
}

async function withProjectLock<T>(plannerRoot: string, blockId: string, callback: () => Promise<T>): Promise<T> {
  const lockDir = path.join(plannerRoot, "locks");
  await fs.mkdir(lockDir, { recursive: true });
  const locks = [path.join(lockDir, "project.lock"), path.join(lockDir, `${blockId}.lock`)];
  const handles: fs.FileHandle[] = [];
  try {
    for (const lock of locks) {
      handles.push(await fs.open(lock, "wx"));
    }
    return await callback();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Another implementation job is already active for project or block ${blockId}.`);
    }
    throw error;
  } finally {
    for (const handle of handles) await handle.close().catch(() => undefined);
    for (const lock of locks) await fs.rm(lock, { force: true }).catch(() => undefined);
  }
}

function verificationMarkdown(results: ExecResult[], passed: boolean, failureReason?: string): string {
  return [
    "# Runtime Verification",
    "",
    `Status: ${passed ? "passed" : "not verified"}`,
    failureReason ? `Failure reason: ${failureReason}` : "Failure reason: none",
    "",
    ...results.map((result, index) => [`## Command ${index + 1}`, "", `Command: ${result.command}`, `Exit code: ${result.exitCode}`, `Duration ms: ${result.durationMs}`, `Timed out: ${result.timedOut}`].join("\n"))
  ].join("\n");
}

async function appendJsonl(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function nextRunId(): string {
  return `R-${Date.now()}-${process.pid}`;
}

function nextJobId(): string {
  return `J-${Date.now()}-${process.pid}`;
}