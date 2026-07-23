import assert from "node:assert/strict";
import test from "node:test";
import { decomposePlanText } from "../src/decompose.js";

test("auto decomposition defaults to no more than 12 merged blocks", () => {
  const plan = Array.from({ length: 30 }, (_, index) => {
    const number = index + 1;
    return `## ${number}. Capability ${number}\n\nImplement capability ${number} with inputs, outputs, and research requirements.`;
  }).join("\n\n");

  const blocks = decomposePlanText(plan, "system-plan.md");
  assert.equal(blocks.length, 12);
  assert.match(blocks[0].title, /Capability 1 \/ Capability 3/);
  assert.match(blocks[0].source_excerpt ?? "", /Included source sections/);
  assert.equal(blocks[1].depends_on?.[0], "B-001");
});

test("preserveSections keeps every heading as its own block", () => {
  const plan = Array.from({ length: 14 }, (_, index) => {
    const number = index + 1;
    return `## ${number}. Capability ${number}\n\nImplement capability ${number}.`;
  }).join("\n\n");

  const blocks = decomposePlanText(plan, "system-plan.md", { preserveSections: true });
  assert.equal(blocks.length, 14);
});
