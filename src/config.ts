import fs from "node:fs/promises";
import path from "node:path";

export type ConstantXRuntimeName = "wsl2" | "local-project";

export type ConstantXConfig = {
  execution: {
    runtime: ConstantXRuntimeName;
    wslDistro?: string;
    timeoutSeconds: number;
    cleanupEphemeral: boolean;
    maxActiveJobs: number;
    localProjectFallbackApproved: boolean;
    applyPatch: boolean;
    implementationCommands: string[];
  };
  agent: {
    provider: string;
  };
  verification: {
    commands: string[];
  };
  mcp: {
    mode: "stdio" | "http";
    host: string;
    port: number;
  };
};
export type ConstantXConfigInput = {
  execution?: Partial<ConstantXConfig["execution"]>;
  agent?: Partial<ConstantXConfig["agent"]>;
  verification?: Partial<ConstantXConfig["verification"]>;
  mcp?: Partial<ConstantXConfig["mcp"]>;
};
const DEFAULT_CONFIG: ConstantXConfig = {
  execution: {
    runtime: "wsl2",
    timeoutSeconds: 1800,
    cleanupEphemeral: true,
    maxActiveJobs: 1,
    localProjectFallbackApproved: false,
    applyPatch: false,
    implementationCommands: []
  },
  agent: {
    provider: "codex"
  },
  verification: {
    commands: []
  },
  mcp: {
    mode: "stdio",
    host: "127.0.0.1",
    port: 4317
  }
};

export async function loadConstantXConfig(projectRoot: string): Promise<{ config: ConstantXConfig; path?: string }> {
  const candidates = [
    path.join(projectRoot, "deep-research.config.json"),
    path.join(projectRoot, "constantx.config.json")
  ];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      const parsed = JSON.parse(await fs.readFile(candidate, "utf8")) as ConstantXConfigInput;
      return { config: normalizeConfig(parsed), path: candidate };
    }
  }

  return { config: DEFAULT_CONFIG };
}

export function normalizeConfig(input: ConstantXConfigInput): ConstantXConfig {
  const execution: Partial<ConstantXConfig["execution"]> = input.execution ?? {};
  const runtime = execution.runtime === "local-project" ? "local-project" : "wsl2";
  return {
    execution: {
      runtime,
      wslDistro: trimOptional(execution.wslDistro),
      timeoutSeconds: positiveInt(execution.timeoutSeconds, DEFAULT_CONFIG.execution.timeoutSeconds),
      cleanupEphemeral: execution.cleanupEphemeral ?? DEFAULT_CONFIG.execution.cleanupEphemeral,
      maxActiveJobs: positiveInt(execution.maxActiveJobs, DEFAULT_CONFIG.execution.maxActiveJobs),
      localProjectFallbackApproved: execution.localProjectFallbackApproved ?? DEFAULT_CONFIG.execution.localProjectFallbackApproved,
      applyPatch: execution.applyPatch ?? DEFAULT_CONFIG.execution.applyPatch,
      implementationCommands: stringArray(execution.implementationCommands)
    },
    agent: {
      provider: trimOptional(input.agent?.provider) ?? DEFAULT_CONFIG.agent.provider
    },
    verification: {
      commands: stringArray(input.verification?.commands)
    },
    mcp: {
      mode: input.mcp?.mode === "http" ? "http" : "stdio",
      host: trimOptional(input.mcp?.host) ?? DEFAULT_CONFIG.mcp.host,
      port: positiveInt(input.mcp?.port, DEFAULT_CONFIG.mcp.port)
    }
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function trimOptional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}