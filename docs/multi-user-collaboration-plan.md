# Multi-User Collaboration Provenance Plan

This plan upgrades ConstantX from a single-user workflow ledger into a collaboration-aware engineering harness while preserving the five public workflow command families:

```text
workflow.start_project
workflow.write_blocks
workflow.refine
workflow.gather_evidence
workflow.implement
```

The goal is to make every workflow action answer these questions:

```text
who did it
what role they had
which block or artifact they touched
what they intended to do
how far the action was allowed to go
what changed
```

## Current Limitation

The current system records some reviewer strings such as `approvedBy`, `approved_by`, `finalized_by`, and `verifier`, but it does not have a normalized collaboration model.

Current gaps:

- The graph is technical only: blocks, statuses, dependencies, related blocks, and paper IDs.
- Audit log entries contain `timestamp`, `event`, and `data`, but no top-level actor, role, scope, intent, or execution mode.
- Design turns do not record who created the turn.
- Implementation records do not record who implemented the block.
- Attribution is sometimes written into markdown but is not consistently stored in state.
- There is no role validation or scope validation for multi-person work.

## Collaboration Context

Every mutating workflow action should resolve a collaboration context.

```text
Actor
Role
Scope
Intent
Execution mode
```

### Actor

The actor is the person, agent name, or service name responsible for the action.

Examples:

```text
ayode
fikayo
codex
claude
ci-runner
```

### Role

Roles define responsibility, not identity type.

```text
owner
researcher
reviewer
implementer
verifier
```

Role meanings:

- `owner`: responsible for product direction and final decisions.
- `researcher`: gathers and extracts evidence.
- `reviewer`: checks and approves research, design, specs, or implementation direction.
- `implementer`: writes or rewrites code.
- `verifier`: checks implementation against criteria, evidence, and spec.

### Scope

Scope limits what the action is allowed to touch.

```text
project
B-001
B-001, B-002
artifact: blocks/B-001/spec.md
```

Scope must be enforced against project paths and block IDs so an action for one block cannot silently mutate another block.

### Intent

Intent describes what the actor is trying to do.

Examples:

```text
start_project
write_blocks
refine_design
gather_evidence
approve_research
create_spec
approve_spec
implement
reimplement
verify
inspect
```

### Execution Mode

Execution mode defines how far the action is allowed to go.

```text
review-only
draft
approve
implement
reimplement
verify-only
```

Mode meanings:

- `review-only`: inspect, compare, ask questions, and record discussion only.
- `draft`: create draft artifacts, but do not approve or implement.
- `approve`: approve an existing artifact or decision.
- `implement`: implement if not already implemented.
- `reimplement`: replace or overwrite the previous implementation record and implementation direction.
- `verify-only`: verify without changing implementation.

## Prompt Shape

The prompt remains natural-language first, but collaboration context can be included when needed.

```text
Use ConstantX. Refine block B-001 in project <PROJECT_PATH>.

Actor: ayode
Role: owner
Scope: B-001
Intent: refine design before spec generation
Execution mode: review-only

I want to decide whether this block should use SAM 2 or Mask2Former.
Do not create the spec or implement yet.
```

Implementation prompt:

```text
Use ConstantX. Approve spec, implement, record, and verify block B-001 in project <PROJECT_PATH>.

Actor: codex
Role: implementer
Scope: B-001
Intent: implement approved block spec
Execution mode: reimplement
Reviewer: fikayo
```

## State Model Changes

Extend `.planner/state.json` with collaboration metadata.

```text
actors
collaboration_contexts
```

Actor record:

```json
{
  "id": "ayode",
  "display_name": "ayode",
  "roles_used": ["owner", "reviewer"],
  "first_seen_at": "2026-08-13T00:00:00.000Z",
  "last_seen_at": "2026-08-13T00:00:00.000Z"
}
```

Collaboration context record:

```json
{
  "context_id": "CTX-001",
  "actor": "ayode",
  "role": "owner",
  "scope": ["B-001"],
  "intent": "refine_design",
  "execution_mode": "review-only",
  "created_at": "2026-08-13T00:00:00.000Z"
}
```

## Audit Log Upgrade

Current audit log shape:

```json
{
  "timestamp": "...",
  "event": "directive_added",
  "data": {}
}
```

New audit log shape:

```json
{
  "timestamp": "...",
  "event": "directive_added",
  "actor": "ayode",
  "role": "owner",
  "scope": ["B-001"],
  "intent": "refine_design",
  "execution_mode": "approve",
  "data": {}
}
```

The audit log should become the durable source for who did what and when.

## Artifact Attribution

Add attribution fields to state records and mirror important details into markdown files.

Required attribution fields:

- `blocks`: `created_by`, `updated_by`
- `pins`: `created_by`, `updated_by`
- `criteria`: `created_by`, `updated_by`
- `design_turns`: `created_by`
- `design_sessions`: `created_by`, `finalized_by`
- `directives`: `proposed_by`, `approved_by`
- `papers/evidence`: `added_by`, `extracted_by`, `approved_by`
- `specs`: `generated_by`, `approved_by`
- `implementation`: `implemented_by`
- `verification`: `verified_by`

## Role Validation

Each workflow family should validate that the provided role is allowed to perform the intended action.

Suggested rules:

- `owner`: can start projects, write blocks, refine, approve, implement, and verify.
- `researcher`: can gather evidence and draft evidence summaries.
- `reviewer`: can refine, approve research, approve specs, and approve directives.
- `implementer`: can implement and reimplement approved specs.
- `verifier`: can verify implemented blocks.

Invalid role/action combinations should be rejected with a clear message.

## Scope Validation

Scope must restrict file and block mutations.

Examples:

- `Scope: B-001` allows writes only to B-001 block artifacts and project-level audit state needed for that action.
- `Scope: B-001, B-002` allows writes only to those blocks.
- `Scope: project` allows project-level operations like project creation and block writing.
- `Scope: artifact: blocks/B-001/spec.md` allows only that artifact plus audit/state updates.

Scope validation should reuse the existing project path guard rules and add block-level checks.

## Graph Changes

Keep the current technical graph, but enrich block nodes with collaboration attribution.

Example node:

```json
{
  "id": "B-001",
  "title": "Scene Intake And Entity Discovery",
  "status": "verified",
  "created_by": "ayode",
  "last_updated_by": "codex",
  "approved_by": "fikayo",
  "implemented_by": "codex",
  "verified_by": "fikayo"
}
```

A separate `collaboration-graph.json` can be added later if needed.

Potential collaboration graph edge shape:

```json
{
  "from": "ayode",
  "to": "B-001",
  "type": "approved_spec",
  "timestamp": "2026-08-13T00:00:00.000Z"
}
```

## Backward Compatibility

If actor context is not provided, ConstantX should default safely.

```text
Actor: local-user
Role: owner
Scope: inferred from command
Intent: inferred from command
Execution mode: inferred from command
```

The response should include a warning:

```text
No Actor was provided. Recorded as local-user. For collaboration, include Actor and Role.
```

## Implementation Order

1. Add collaboration context types and defaults.
2. Upgrade audit log to include actor, role, scope, intent, and execution mode.
3. Add attribution fields to state records.
4. Pass collaboration context through all workflow commands.
5. Add role validation.
6. Add scope validation.
7. Upgrade graph output with attribution fields.
8. Update markdown writers to include attribution where useful.
9. Update docs and prompt templates.
10. Add tests and run full verification.

## Implementation Checklist

### Phase 1: Collaboration Context

- [x] Add `Role`, `ExecutionMode`, `CollaborationContext`, `ActorRecord`, and `CollaborationContextRecord` types.
- [x] Add `actors` and `collaboration_contexts` to planner state.
- [x] Add migration/default handling for existing `.planner/state.json` files.
- [x] Add helpers to normalize actor names, roles, scope, intent, and execution mode.
- [x] Add fallback context using `local-user` when no actor is provided.

### Phase 2: Actor-Aware Audit

- [x] Upgrade `audit()` to accept collaboration context.
- [x] Keep backward-compatible audit entries for older projects.
- [x] Persist actor, role, scope, intent, and execution mode in every new audit log entry.
- [x] Update every mutating storage method to pass context into audit.

### Phase 3: Artifact Attribution

- [ ] Add `created_by` and `updated_by` to block records.
- [ ] Add `created_by` and `updated_by` to pin records.
- [ ] Add `created_by` and `updated_by` to acceptance criteria records.
- [ ] Add `created_by` to design turn records.
- [ ] Add `created_by` and `finalized_by` to design session records.
- [ ] Add `proposed_by` and `approved_by` handling to directive records.
- [ ] Add evidence attribution fields where paper/evidence records are created, extracted, or approved.
- [ ] Add implementation attribution for implementation records.
- [ ] Add verification attribution for verification records.

### Phase 4: Workflow Integration

- [x] Add optional collaboration context input to `workflow.start_project`.
- [x] Add optional collaboration context input to `workflow.write_blocks`.
- [x] Add optional collaboration context input to `workflow.refine`.
- [x] Add optional collaboration context input to `workflow.gather_evidence`.
- [x] Add optional collaboration context input to `workflow.implement`.
- [x] Propagate context from workflow tools to internal planner methods.
- [x] Return context warnings when actor context is inferred.

### Phase 5: Role And Scope Gates

- [x] Add role permission validation per workflow family.
- [ ] Add intent/mode validation per workflow family.
- [x] Add block scope validation for block-specific operations.
- [ ] Add artifact scope validation for direct artifact operations.
- [x] Add clear rejection messages for role or scope mismatches.

### Phase 6: Graph And Markdown Output

- [x] Add attribution fields to `graph.json` block nodes.
- [ ] Add attribution fields to `graph.md` block rows.
- [ ] Add attribution summaries to `block.md` where useful.
- [x] Add attribution summaries to `directives.md`, `design-session.md`, `implementation.md`, and approval sections.
- [ ] Decide whether `collaboration-graph.json` should be added now or deferred.

### Phase 7: Tests

- [x] Test missing actor fallback to `local-user`.
- [x] Test audit log includes actor, role, scope, intent, and execution mode.
- [x] Test directives store proposed and approved attribution.
- [x] Test design turns store created attribution.
- [x] Test implementation records store implementer attribution.
- [x] Test verification records store verifier attribution.
- [x] Test graph output includes attribution fields.
- [x] Test role mismatch rejection.
- [x] Test block scope mismatch rejection.
- [ ] Test backward compatibility with existing state files.

### Phase 8: Verification

- [x] Run TypeScript build.
- [x] Run unit tests.
- [x] Run full verification script.
- [x] Update this checklist as each item is completed.

## Completion Criteria

This phase is complete when:

- Every workflow action records who performed it.
- Every major artifact can be traced to who created, updated, approved, implemented, or verified it.
- The audit log can answer who did what without reading markdown files.
- The graph exposes useful attribution fields for each block.
- Role and scope validation prevent accidental or unauthorized cross-block mutation.
- Existing projects still load successfully.
- All tests and verification commands pass.

## Current Implementation Status

Implemented in this phase:

- Optional collaboration context fields on MCP tool schemas.
- Actor records and collaboration context records in planner state.
- Actor-aware audit log entries with fallback `local-user` provenance.
- Role and block-scope validation through the collaboration resolver.
- Block creation/update attribution and graph node attribution.
- Attribution for research/spec approvals, directives, implementation records, and verification records.
- Regression test covering actor/role/scope state, audit, graph attribution, and role rejection.

Still available for a later hardening pass:

- Expand attribution assertions across every lower-level planner tool.
- Add optional `collaboration-graph.json`.
- Add stronger artifact-level scope enforcement for direct source file mutations.
- Add team/permission configuration if ConstantX needs persistent project-level policies.
