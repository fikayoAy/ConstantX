import path from "node:path";

export function nowIso(): string {
  return new Date().toISOString();
}

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "untitled";
}

export function resolveProjectRoot(projectPath?: string): string {
  const workspaceRoot = path.resolve(process.cwd());
  const target = path.resolve(workspaceRoot, projectPath ?? ".");
  const relative = path.relative(workspaceRoot, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Project path must stay inside the MCP server working directory: ${workspaceRoot}`);
  }

  return target;
}

export function relativeToProject(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).replace(/\\/g, "/");
}

export function normalizeId(value: string): string {
  return value.trim().toUpperCase();
}

export function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function toJsonText(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
