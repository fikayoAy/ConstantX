import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ExecResult, RuntimeJob } from "./types.js";

export async function copyProjectForJob(projectRoot: string, baselinePath: string, workspacePath: string): Promise<void> {
  await fs.rm(baselinePath, { recursive: true, force: true });
  await fs.rm(workspacePath, { recursive: true, force: true });
  await fs.mkdir(baselinePath, { recursive: true });
  await fs.mkdir(workspacePath, { recursive: true });
  await copyTopLevelEntries(projectRoot, baselinePath);
  await copyTopLevelEntries(projectRoot, workspacePath);
}

export function runShellCommand(command: string, cwd: string, timeoutSeconds: number): Promise<ExecResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(cwd) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutSeconds * 1000);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ command, cwd, exitCode: null, stdout, stderr: `${stderr}${error.message}`, durationMs: Date.now() - started, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ command, cwd, exitCode: code, stdout, stderr, durationMs: Date.now() - started, timedOut });
    });
  });
}

export async function collectGitPatch(job: RuntimeJob): Promise<{ patch: string; changedFiles: string[]; hasChanges: boolean }> {
  const gitRoot = await runShellCommand("git rev-parse --show-toplevel", job.workspacePath, job.timeoutSeconds);
  const canUseWorkspaceGit = gitRoot.exitCode === 0 && path.resolve(gitRoot.stdout.trim()) === path.resolve(job.workspacePath);
  const gitDiff = canUseWorkspaceGit ? await runShellCommand("git diff --binary", job.workspacePath, job.timeoutSeconds) : { exitCode: null, stdout: "", stderr: "" } as Awaited<ReturnType<typeof runShellCommand>>;
  const gitStatus = canUseWorkspaceGit ? await runShellCommand("git status --porcelain", job.workspacePath, job.timeoutSeconds) : { exitCode: null, stdout: "", stderr: "" } as Awaited<ReturnType<typeof runShellCommand>>;
  if (gitDiff.exitCode === 0 && gitStatus.exitCode === 0) {
    const untracked = gitStatus.stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("?? "))
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
    let untrackedPatch = "";
    for (const file of untracked) {
      const absolute = path.join(job.workspacePath, file);
      const stat = await safeStat(absolute);
      if (stat?.isFile()) {
        const content = await fs.readFile(absolute, "utf8").catch(() => "");
        untrackedPatch += [`diff --git a/${file} b/${file}`, "new file mode 100644", "--- /dev/null", `+++ b/${file}`, "@@", ...content.split(/\r?\n/).map((line) => `+${line}`), ""].join("\n");
      }
    }
    const patch = `${gitDiff.stdout}${untrackedPatch}`;
    const changedFiles = parseStatusChangedFiles(gitStatus.stdout);
    return { patch, changedFiles, hasChanges: patch.trim().length > 0 || changedFiles.length > 0 };
  }

  const noIndex = await runShellCommand(`git diff --no-index --binary "${job.baselinePath}" "${job.workspacePath}"`, path.dirname(job.workspacePath), job.timeoutSeconds);
  const patch = noIndex.stdout || noIndex.stderr;
  return { patch, changedFiles: await changedFilesByWalk(job.baselinePath, job.workspacePath), hasChanges: patch.trim().length > 0 };
}

export async function collectArtifactFiles(job: RuntimeJob): Promise<string[]> {
  const artifactsRoot = path.join(job.workspacePath, "artifacts");
  const files: string[] = [];
  await walkIfExists(artifactsRoot, async (file) => {
    files.push(path.relative(job.workspacePath, file).replace(/\\/g, "/"));
  });
  return files;
}

async function copyTopLevelEntries(projectRoot: string, destinationRoot: string): Promise<void> {
  const filter = copyFilter(projectRoot);
  for (const entry of await fs.readdir(projectRoot, { withFileTypes: true })) {
    const source = path.join(projectRoot, entry.name);
    if (!filter(source)) continue;
    await fs.cp(source, path.join(destinationRoot, entry.name), { recursive: true, filter });
  }
}
function copyFilter(projectRoot: string): (source: string) => boolean {
  return (source) => {
    const rel = path.relative(projectRoot, source).replace(/\\/g, "/");
    if (!rel) return true;
    if (rel === "node_modules" || rel.startsWith("node_modules/")) return false;
    if (rel === "dist" || rel.startsWith("dist/")) return false;
    if (rel === ".planner" || rel.startsWith(".planner/")) return false;
    if (rel === ".test-output" || rel.startsWith(".test-output/")) return false;
    return true;
  };
}

function parseStatusChangedFiles(status: string): string[] {
  return status
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

async function changedFilesByWalk(baselinePath: string, workspacePath: string): Promise<string[]> {
  const changed: string[] = [];
  await walkIfExists(workspacePath, async (file) => {
    const rel = path.relative(workspacePath, file);
    const baseline = path.join(baselinePath, rel);
    const [a, b] = await Promise.all([fs.readFile(baseline).catch(() => undefined), fs.readFile(file).catch(() => undefined)]);
    if (!a || !b || !a.equals(b)) changed.push(rel.replace(/\\/g, "/"));
  });
  return changed;
}

async function walkIfExists(root: string, onFile: (file: string) => Promise<void>): Promise<void> {
  const stat = await safeStat(root);
  if (!stat) return;
  if (stat.isFile()) {
    await onFile(root);
    return;
  }
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walkIfExists(full, onFile);
    else if (entry.isFile()) await onFile(full);
  }
}

async function safeStat(filePath: string) {
  return fs.stat(filePath).catch(() => undefined);
}
