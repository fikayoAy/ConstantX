import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WslDistro } from "./types.js";

const execFileAsync = promisify(execFile);

export async function detectWslDistros(): Promise<WslDistro[]> {
  try {
    const { stdout } = await execFileAsync("wsl.exe", ["--list", "--verbose"], { windowsHide: true });
    return parseWslListVerbose(stdout);
  } catch {
    return [];
  }
}

export function parseWslListVerbose(output: string): WslDistro[] {
  const text = stripBom(output).replace(/\u0000/g, "");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^NAME\s+STATE\s+VERSION$/i.test(line))
    .map((line) => {
      const isDefault = line.startsWith("*");
      const clean = line.replace(/^\*\s*/, "").trim();
      const match = clean.match(/^(.*?)\s{2,}(\S+)\s+(\d+)$/) ?? clean.match(/^(.*?)\s+(Running|Stopped)\s+(\d+)$/i);
      if (!match) {
        return { name: clean, isDefault };
      }
      return {
        name: match[1].trim(),
        state: match[2],
        version: Number.parseInt(match[3], 10),
        isDefault
      };
    })
    .filter((distro) => distro.name.length > 0);
}

export function selectWslDistro(distros: WslDistro[], configured?: string): WslDistro | undefined {
  if (configured) {
    return distros.find((distro) => distro.name.toLowerCase() === configured.toLowerCase());
  }
  return distros.find((distro) => distro.isDefault) ?? distros[0];
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}