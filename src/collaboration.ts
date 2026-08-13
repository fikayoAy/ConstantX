import type {
  ActorRecord,
  BlockRecord,
  CollaborationContextInput,
  CollaborationContextRecord,
  CollaborationRole,
  ExecutionMode,
  PlannerState
} from "./types.js";
import { nowIso, relativeToProject } from "./utils.js";

export type CollaborationDefaults = {
  role: CollaborationRole;
  scope: string[];
  intent: string;
  executionMode: ExecutionMode;
  allowedRoles?: CollaborationRole[];
  block?: BlockRecord;
};

export type ResolvedCollaboration = {
  context: CollaborationContextRecord;
  warnings: string[];
};

export function resolveCollaborationContext(
  state: PlannerState,
  input: CollaborationContextInput | undefined,
  defaults: CollaborationDefaults
): ResolvedCollaboration {
  const warnings: string[] = [];
  const timestamp = nowIso();
  const rawActor = input?.actor?.trim();
  const actor = rawActor && rawActor.length > 0 ? rawActor : "local-user";
  if (!rawActor) {
    warnings.push("No Actor was provided. Recorded as local-user. For collaboration, include Actor and Role.");
  }

  const role = input?.role ?? defaults.role;
  const allowedRoles = defaults.allowedRoles ?? [defaults.role];
  if (!allowedRoles.includes(role)) {
    throw new Error(`Role ${role} cannot perform intent ${defaults.intent}. Allowed roles: ${allowedRoles.join(", ")}.`);
  }

  const scope = normalizeScope(input?.scope, defaults.scope);
  if (defaults.block) {
    validateBlockScope(scope, defaults.block);
  }

  state.counters.collaborationContexts ??= 0;
  state.actors ??= {};
  state.collaboration_contexts ??= {};

  const existing: ActorRecord | undefined = state.actors[actor];
  state.actors[actor] = existing
    ? {
        ...existing,
        display_name: existing.display_name || actor,
        roles_used: uniqueRoleList([...existing.roles_used, role]),
        last_seen_at: timestamp
      }
    : {
        id: actor,
        display_name: actor,
        roles_used: [role],
        first_seen_at: timestamp,
        last_seen_at: timestamp
      };

  const context: CollaborationContextRecord = {
    context_id: nextContextId(++state.counters.collaborationContexts),
    actor,
    role,
    scope,
    intent: input?.intent?.trim() || defaults.intent,
    execution_mode: input?.executionMode ?? defaults.executionMode,
    created_at: timestamp,
    warnings: warnings.length > 0 ? warnings : undefined
  };
  state.collaboration_contexts[context.context_id] = context;
  return { context, warnings };
}

export function actorFrom(context: CollaborationContextRecord): string {
  return context.actor;
}

export function collaborationSummary(context: CollaborationContextRecord, warnings: string[] = []): Record<string, unknown> {
  return {
    actor: context.actor,
    role: context.role,
    scope: context.scope,
    intent: context.intent,
    execution_mode: context.execution_mode,
    context_id: context.context_id,
    warnings
  };
}

function normalizeScope(scope: CollaborationContextInput["scope"] | undefined, fallback: string[]): string[] {
  const raw = Array.isArray(scope) ? scope : scope ? scope.split(",") : fallback;
  const normalized = raw.map((item) => item.trim()).filter(Boolean);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : fallback;
}

function validateBlockScope(scope: string[], block: BlockRecord): void {
  const normalizedBlockId = block.id.toLowerCase();
  const normalizedDir = block.dir.replace(/\\/g, "/").toLowerCase();
  const allowed = scope.some((item) => {
    const value = item.replace(/\\/g, "/").toLowerCase();
    return value === "project"
      || value === normalizedBlockId
      || value === `block ${normalizedBlockId}`
      || value.includes(normalizedDir)
      || value.includes(`/blocks/${normalizedBlockId.toLowerCase()}-`)
      || value.includes(`blocks/${normalizedBlockId.toLowerCase()}-`);
  });

  if (!allowed) {
    throw new Error(`Scope ${scope.join(", ")} does not allow mutation of ${block.id}. Use Scope: ${block.id} or Scope: project.`);
  }
}

function uniqueRoleList(roles: CollaborationRole[]): CollaborationRole[] {
  return Array.from(new Set(roles));
}

function nextContextId(value: number): string {
  return `CTX-${String(value).padStart(3, "0")}`;
}
