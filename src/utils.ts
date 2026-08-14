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
  const target = projectPath && path.isAbsolute(projectPath)
    ? path.resolve(projectPath)
    : path.resolve(workspaceRoot, projectPath ?? ".");
  const allowedRoots = uniqueValues([workspaceRoot, ...configuredAllowedProjectRoots()]).map((root) => path.resolve(root));

  if (!allowedRoots.some((root) => isPathInsideOrEqual(target, root))) {
    throw new Error(`Project path must stay inside an allowed ConstantX project root: ${allowedRoots.join(", ")}`);
  }

  const parsed = path.parse(target);
  if (target === parsed.root) {
    throw new Error("Project path must not be a filesystem root.");
  }

  const segments = target.split(/[\\/]+/).map((segment) => segment.toLowerCase());
  if (segments.includes(".planner")) {
    throw new Error("Project path must be the project directory, not a .planner internal directory.");
  }

  return target;
}

export function configuredAllowedProjectRoots(): string[] {
  return (process.env.CONSTANTX_ALLOWED_PROJECT_ROOTS ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
}

function isPathInsideOrEqual(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
