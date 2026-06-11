import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { AppConfig, InterfaceKind, ProjectConfig } from "./types";

/** The repo a given interface kind reads from (SFR/HAL may live in separate repos). */
export function repoFor(p: ProjectConfig, kind: InterfaceKind): string {
  return (kind === "sfr" ? p.sfrRepo : p.halRepo) || p.repo;
}

/** The directory inside that repo for the given kind. */
export function dirFor(p: ProjectConfig, kind: InterfaceKind): string {
  return kind === "sfr" ? p.rdlDir : p.halDir;
}

/** The statistics baseline ref for the given kind. */
export function baselineFor(p: ProjectConfig, kind: InterfaceKind): string {
  return (kind === "sfr" ? p.sfrBaseline : p.halBaseline) || p.baseline;
}

/** Distinct repos used by a project (deduped) — for refresh / status. */
export function distinctRepos(p: ProjectConfig): string[] {
  return [...new Set([p.repo, repoFor(p, "sfr"), repoFor(p, "hal")])];
}

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
