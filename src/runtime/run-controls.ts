import fs from "node:fs/promises";
import path from "node:path";
import type { ConstantXConfig } from "../config.js";
import { nowIso, relativeToProject } from "../utils.js";
import type { ExecResult } from "./types.js";
import { copyProjectForJob, runShellCommand } from "./runtime-utils.js";

export type RuntimeControlAction = "inspect-run" | "apply-patch" | "rerun-verification";

export type RunInspection = {
  runId: string;
  run?: Record<string, unknown>;
  job?: Record<string, unknown>;
  status?: string;
  blockId?: string;
  failureReason?: string;
  failedCommand?: unknown;
  persistentRunDir: string;
  patchPath?: string;
  verificationPath?: string;
  logs: string[];
  suggestedNextSteps: string[];
};

export type PatchApplyResult = {
  runId: string;
  approved: boolean;
  applied: boolean;
  patchPath: string;
  check: ExecResult;
  apply?: ExecResult;
  nextActions: string[];
};

export type VerificationRerunResult = {
  runId: string;
  rerunId: string;
  status: "passed" | "failed";
  results: ExecResult[];
  verificationPath: string;
  logPaths: string[];
  workspacePath: string;
  cleanupEphemeral: boolean;
};

export async function inspectRuntimeRun(projectRoot: string, plannerRoot: string, runId: string): Promise<RunInspection> {
  const runDir = runDirectory(plannerRoot, runId);
  const run = await readJsonIfExists(path.join(runDir, "run.json"));
  const job = await readJsonIfExists(path.join(runDir, "job.json"));
  const logs = await listFiles(path.join(runDir, "logs"));
  const patchPath = await existingPath(path.join(runDir, "patches", "final.patch"));
  const verificationPath = await existingPath(path.join(runDir, "verification.md"));
  const commands = Array.isArray(run?.commands_run) ? run.commands_run : [];
  const failedCommand = commands.find((command) => typeof command === "object" && command && "exitCode" in command && command.exitCode !== 0);
  const status = stringValue(run?.status ?? job?.status);
  const failureReason = stringValue(run?.failure_reason ?? job?.failure_reason);
  return {
    runId,
    run,
    job,
    status,
    blockId: stringValue(run?.block_id ?? job?.block_id),
    failureReason,
    failedCommand,
    persistentRunDir: relativeToProject(projectRoot, runDir),
    patchPath: patchPath ? relativeToProject(projectRoot, patchPath) : undefined,
    verificationPath: verificationPath ? relativeToProject(projectRoot, verificationPath) : undefined,
    logs: logs.map((log) => relativeToProject(projectRoot, log)),
    suggestedNextSteps: nextSteps(status, Boolean(patchPath), Boolean(failedCommand), failureReason)
  };
}

export async function applyRuntimePatch(projectRoot: string, plannerRoot: string, runId: string, approved: boolean): Promise<PatchApplyResult> {
  const patchPath = path.join(runDirectory(plannerRoot, runId), "patches", "final.patch");
  await requireFile(patchPath, `No patch found for run ${runId}.`);
  if (!approved) {
    throw new Error("Patch apply requires explicit approval. Pass applyPatchApproved=true after reviewing final.patch.");
  }
  const check = await runShellCommand(`git apply --check "${patchPath}"`, projectRoot, 120);
  if (check.exitCode !== 0) {
    await appendControlEvent(plannerRoot, { action: "apply-patch", run_id: runId, status: "failed-check", patch_path: patchPath, check });
    return {
      runId,
      approved,
      applied: false,
      patchPath: relativeToProject(projectRoot, patchPath),
      check,
      nextActions: ["Patch check failed. Inspect final.patch and current working tree before applying."]
    };
  }
  const apply = await runShellCommand(`git apply "${patchPath}"`, projectRoot, 120);
  const applied = apply.exitCode === 0;
  await appendControlEvent(plannerRoot, { action: "apply-patch", run_id: runId, status: applied ? "applied" : "failed-apply", patch_path: patchPath, check, apply });
  return {
    runId,
    approved,
    applied,
    patchPath: relativeToProject(projectRoot, patchPath),
    check,
    apply,
    nextActions: applied
      ? ["Patch applied to the real project. Run verification or workflow.implement evidence recording next."]
      : ["Patch apply failed after check. Inspect git state and final.patch."]
  };
}

export async function rerunRuntimeVerification(projectRoot: string, plannerRoot: string, runId: string, config: ConstantXConfig): Promise<VerificationRerunResult> {
  if (config.verification.commands.length === 0) {
    throw new Error("Cannot rerun verification because verification.commands is empty in ConstantX config.");
  }
  const rerunId = `VR-${Date.now()}-${process.pid}`;
  const runDir = runDirectory(plannerRoot, runId);
  await requireFile(path.join(runDir, "run.json"), `Unknown runtime run ${runId}.`);
  const jobRoot = path.join(plannerRoot, "ephemeral", "verification-reruns", rerunId);
  const workspacePath = path.join(jobRoot, "repo");
  const baselinePath = path.join(jobRoot, "baseline");
  await copyProjectForJob(projectRoot, baselinePath, workspacePath);

  const patchPath = path.join(runDir, "patches", "final.patch");
  if (await exists(patchPath)) {
    const patchResult = await runShellCommand(`git apply "${patchPath}"`, workspacePath, config.execution.timeoutSeconds);
    if (patchResult.exitCode !== 0) {
      const verificationPath = await writeRerunVerification(runDir, rerunId, [patchResult], false, `Could not apply patch before verification rerun.`);
      return { runId, rerunId, status: "failed", results: [patchResult], verificationPath: relativeToProject(projectRoot, verificationPath), logPaths: [], workspacePath: relativeToProject(projectRoot, workspacePath), cleanupEphemeral: false };
    }
  }

  const results: ExecResult[] = [];
  const logPaths: string[] = [];
  const logsDir = path.join(runDir, "logs", rerunId);
  await fs.mkdir(logsDir, { recursive: true });
  for (const command of config.verification.commands) {
    const result = await runShellCommand(command, workspacePath, config.execution.timeoutSeconds);
    results.push(result);
    const logPath = path.join(logsDir, `verify-${results.length}.log`);
    await fs.writeFile(logPath, commandLog(result), "utf8");
    logPaths.push(relativeToProject(projectRoot, logPath));
    if (result.exitCode !== 0) break;
  }
  const passed = results.length === config.verification.commands.length && results.every((result) => result.exitCode === 0);
  const verificationPath = await writeRerunVerification(runDir, rerunId, results, passed);
  await appendControlEvent(plannerRoot, { action: "rerun-verification", run_id: runId, rerun_id: rerunId, status: passed ? "passed" : "failed", commands_run: results.map((result) => ({ command: result.command, exitCode: result.exitCode, durationMs: result.durationMs })) });
  if (config.execution.cleanupEphemeral) {
    await fs.rm(jobRoot, { recursive: true, force: true });
  }
  return { runId, rerunId, status: passed ? "passed" : "failed", results, verificationPath: relativeToProject(projectRoot, verificationPath), logPaths, workspacePath: relativeToProject(projectRoot, workspacePath), cleanupEphemeral: config.execution.cleanupEphemeral };
}

function runDirectory(plannerRoot: string, runId: string): string {
  return path.join(plannerRoot, "persistent", "runs", runId);
}

async function writeRerunVerification(runDir: string, rerunId: string, results: ExecResult[], passed: boolean, failureReason?: string): Promise<string> {
  const filePath = path.join(runDir, `verification-${rerunId}.md`);
  const body = [
    `# Verification Rerun ${rerunId}`,
    "",
    `Status: ${passed ? "passed" : "failed"}`,
    failureReason ? `Failure reason: ${failureReason}` : "Failure reason: none",
    "",
    ...results.map((result, index) => [`## Command ${index + 1}`, "", `Command: ${result.command}`, `Exit code: ${result.exitCode}`, `Duration ms: ${result.durationMs}`, `Timed out: ${result.timedOut}`].join("\n"))
  ].join("\n");
  await fs.writeFile(filePath, body, "utf8");
  return filePath;
}

function commandLog(result: ExecResult): string {
  return [`$ ${result.command}`, `cwd: ${result.cwd}`, `exitCode: ${result.exitCode}`, `durationMs: ${result.durationMs}`, "", "## stdout", result.stdout, "", "## stderr", result.stderr].join("\n");
}

async function readJsonIfExists(filePath: string): Promise<Record<string, unknown> | undefined> {
  if (!(await exists(filePath))) return undefined;
  return JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
}

async function listFiles(dirPath: string): Promise<string[]> {
  if (!(await exists(dirPath))) return [];
  const output: string[] = [];
  for (const entry of await fs.readdir(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(full));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

async function existingPath(filePath: string): Promise<string | undefined> {
  return await exists(filePath) ? filePath : undefined;
}

async function requireFile(filePath: string, message: string): Promise<void> {
  if (!(await exists(filePath))) throw new Error(message);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nextSteps(status?: string, hasPatch?: boolean, hasFailedCommand?: boolean, failureReason?: string): string[] {
  if (status === "failed" || hasFailedCommand) {
    return ["Open the failed command log and verification file.", "Fix the failed implementation or verification issue, then rerun verification."];
  }
  if (status === "completed" && hasPatch) {
    return ["Review final.patch.", "Apply the patch only after explicit approval.", "Record implementation evidence through workflow.implement." ];
  }
  if (failureReason) {
    return ["Inspect the failure reason and related logs.", "Restart workflow.implement after correcting the blocker."];
  }
  return ["Review run.json, job.json, logs, verification.md, and patch paths."];
}

async function appendControlEvent(plannerRoot: string, value: Record<string, unknown>): Promise<void> {
  await fs.appendFile(path.join(plannerRoot, "runtime-controls.jsonl"), `${JSON.stringify({ timestamp: nowIso(), ...value })}\n`, "utf8");
}