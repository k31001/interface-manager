import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { AppConfig, ProjectConfig } from "./types";

const CONFIG_PATH = join(process.cwd(), "data", "config.json");

const DEFAULT_CONFIG: AppConfig = { projects: [] };

export function readConfig(): AppConfig {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    if (!Array.isArray(raw.projects)) return DEFAULT_CONFIG;
    return raw as AppConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function writeConfig(cfg: AppConfig) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

export function getProject(id: string): ProjectConfig | undefined {
  return readConfig().projects.find((p) => p.id === id);
}

export function requireProject(id: string): ProjectConfig {
  const p = getProject(id);
  if (!p) throw new Error(`Unknown project: ${id}`);
  return p;
}
