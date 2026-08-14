import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveProjectRoot } from "../src/utils.js";

test("resolveProjectRoot allows absolute paths inside configured project roots", () => {
  const previous = process.env.CONSTANTX_ALLOWED_PROJECT_ROOTS;
  const root = path.join(os.tmpdir(), `constantx-allowed-${process.pid}`);
  const project = path.join(root, "project-a");
  process.env.CONSTANTX_ALLOWED_PROJECT_ROOTS = root;
  try {
    assert.equal(resolveProjectRoot(project), path.resolve(project));
  } finally {
    if (previous === undefined) delete process.env.CONSTANTX_ALLOWED_PROJECT_ROOTS;
    else process.env.CONSTANTX_ALLOWED_PROJECT_ROOTS = previous;
  }
});

test("resolveProjectRoot rejects absolute paths outside configured project roots", () => {
  const previous = process.env.CONSTANTX_ALLOWED_PROJECT_ROOTS;
  const root = path.join(os.tmpdir(), `constantx-allowed-${process.pid}`);
  const outside = path.join(os.tmpdir(), `constantx-outside-${process.pid}`);
  process.env.CONSTANTX_ALLOWED_PROJECT_ROOTS = root;
  try {
    assert.throws(() => resolveProjectRoot(outside), /allowed ConstantX project root/);
  } finally {
    if (previous === undefined) delete process.env.CONSTANTX_ALLOWED_PROJECT_ROOTS;
    else process.env.CONSTANTX_ALLOWED_PROJECT_ROOTS = previous;
  }
});

test("resolveProjectRoot rejects .planner internals as project roots", () => {
  const previous = process.env.CONSTANTX_ALLOWED_PROJECT_ROOTS;
  const root = path.join(os.tmpdir(), `constantx-planner-${process.pid}`);
  process.env.CONSTANTX_ALLOWED_PROJECT_ROOTS = root;
  try {
    assert.throws(() => resolveProjectRoot(path.join(root, "project", ".planner")), /not a \.planner internal/);
  } finally {
    if (previous === undefined) delete process.env.CONSTANTX_ALLOWED_PROJECT_ROOTS;
    else process.env.CONSTANTX_ALLOWED_PROJECT_ROOTS = previous;
  }
});