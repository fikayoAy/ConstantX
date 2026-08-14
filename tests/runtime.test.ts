import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { normalizeConfig } from "../src/config.js";
import { runImplementationJob } from "../src/runtime/job-runner.js";
import { parseWslListVerbose, selectWslDistro } from "../src/runtime/wsl-detection.js";

test("config normalization keeps the v1 runtime defaults conservative", () => {
  const config = normalizeConfig({
    execution: {
      runtime: "local-project",
      timeoutSeconds: 45,
      cleanupEphemeral: false,
      maxActiveJobs: 2,
      localProjectFallbackApproved: true,
      applyPatch: true,
      implementationCommands: ["npm test", "  "]
    },
    verification: {
      commands: ["npm run build"]
    },
    mcp: {
      mode: "http",
      host: "127.0.0.1",
      port: 4317
    }
  });

  assert.equal(config.execution.runtime, "local-project");
  assert.equal(config.execution.timeoutSeconds, 45);
  assert.equal(config.execution.cleanupEphemeral, false);
  assert.equal(config.execution.localProjectFallbackApproved, true);
  assert.deepEqual(config.execution.implementationCommands, ["npm test"]);
  assert.deepEqual(config.verification.commands, ["npm run build"]);
  assert.equal(config.mcp.mode, "http");
});

test("WSL parser detects the default distro without assuming Ubuntu", () => {
  const output = [
    "  NAME                   STATE           VERSION",
    "* Debian                 Running         2",
    "  openSUSE-Tumbleweed     Stopped         2",
    "  Kali-Linux             Stopped         1"
  ].join("\n");

  const distros = parseWslListVerbose(output);
  assert.deepEqual(distros.map((distro) => distro.name), ["Debian", "openSUSE-Tumbleweed", "Kali-Linux"]);
  assert.equal(selectWslDistro(distros)?.name, "Debian");
  assert.equal(selectWslDistro(distros, "openSUSE-Tumbleweed")?.version, 2);
});

test("runtime job refuses local-project fallback until explicitly approved", async () => {
  const projectRoot = path.resolve(".test-output", `runtime-fallback-${process.pid}-${Date.now()}`);
  await fs.mkdir(path.join(projectRoot, ".planner"), { recursive: true });

  const result = await runImplementationJob({
    projectRoot,
    plannerRoot: path.join(projectRoot, ".planner"),
    blockId: "B-001",
    implementationContext: "# Context",
    config: normalizeConfig({ execution: { runtime: "local-project" } })
  });

  assert.equal(result.status, "waiting_for_fallback_approval");
  assert.match(result.fallbackPrompt ?? "", /less isolated/i);
});

test("local-project runtime runs commands in an ephemeral copy and persists patch evidence", async () => {
  const projectRoot = path.resolve(".test-output", `runtime-local-${process.pid}-${Date.now()}`);
  await fs.mkdir(path.join(projectRoot, ".planner"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "README.md"), "# Test Project\n", "utf8");

  const result = await runImplementationJob({
    projectRoot,
    plannerRoot: path.join(projectRoot, ".planner"),
    blockId: "B-001",
    implementationContext: "# Context",
    localProjectFallbackApproved: true,
    config: normalizeConfig({
      execution: {
        runtime: "local-project",
        localProjectFallbackApproved: true,
        cleanupEphemeral: false,
        implementationCommands: ["node -e \"require('fs').writeFileSync('generated.txt','ok')\""]
      },
      verification: {
        commands: ["node -e \"if(!require('fs').existsSync('generated.txt')) process.exit(1)\""]
      }
    })
  });

  assert.equal(result.status, "completed");
  assert.equal(result.verificationPassed, true);
  assert.ok(result.patchPath);
  assert.ok(result.artifactManifestPath);
  assert.ok(result.changedFiles.includes("generated.txt"));
  const patch = await fs.readFile(path.join(projectRoot, result.patchPath!), "utf8");
  assert.match(patch, /generated\.txt/);
  const originalGenerated = await fs.readFile(path.join(projectRoot, "generated.txt"), "utf8").catch(() => undefined);
  assert.equal(originalGenerated, undefined);
});
test("runtime controls inspect runs, require patch approval, apply patches, and rerun verification", async () => {
  const projectRoot = path.resolve(".test-output", `runtime-controls-${process.pid}-${Date.now()}`);
  const plannerRoot = path.join(projectRoot, ".planner");
  const runDir = path.join(plannerRoot, "persistent", "runs", "R-CTRL");
  await fs.mkdir(path.join(runDir, "patches"), { recursive: true });
  await fs.mkdir(path.join(runDir, "logs"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "a.txt"), "old\n", "utf8");
  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify({ run_id: "R-CTRL", job_id: "J-CTRL", block_id: "B-001", status: "completed", patch_path: path.join(runDir, "patches", "final.patch") }, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "job.json"), `${JSON.stringify({ run_id: "R-CTRL", job_id: "J-CTRL", block_id: "B-001", status: "completed" }, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "verification.md"), "# Verification\n", "utf8");
  await fs.writeFile(path.join(runDir, "logs", "verify.log"), "ok\n", "utf8");
  await fs.writeFile(path.join(runDir, "patches", "final.patch"), [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    ""
  ].join("\n"), "utf8");

  const { inspectRuntimeRun, applyRuntimePatch, rerunRuntimeVerification } = await import("../src/runtime/run-controls.js");
  const inspected = await inspectRuntimeRun(projectRoot, plannerRoot, "R-CTRL");
  assert.equal(inspected.runId, "R-CTRL");
  assert.equal(inspected.blockId, "B-001");
  assert.ok(inspected.patchPath?.endsWith("final.patch"));
  assert.equal(inspected.logs.length, 1);

  await assert.rejects(() => applyRuntimePatch(projectRoot, plannerRoot, "R-CTRL", false), /explicit approval/i);

  const rerun = await rerunRuntimeVerification(projectRoot, plannerRoot, "R-CTRL", normalizeConfig({
    execution: { runtime: "local-project", localProjectFallbackApproved: true, cleanupEphemeral: true },
    verification: { commands: ["node -e \"if(require('fs').readFileSync('a.txt','utf8').trim() !== 'new') process.exit(1)\""] }
  }));
  assert.equal(rerun.status, "passed");
  assert.ok(rerun.verificationPath.includes("verification-VR-"));

  const applied = await applyRuntimePatch(projectRoot, plannerRoot, "R-CTRL", true);
  assert.equal(applied.applied, true);
  assert.equal((await fs.readFile(path.join(projectRoot, "a.txt"), "utf8")).trim(), "new");
});
