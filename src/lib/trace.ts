import { diskCached } from "./cache";
import { repoFor } from "./config";
import { listFilesAt, readFilesAt, resolveRepoDir, revParse } from "./git";
import { type IpRegs, type RegRef, scanHalImpl } from "./hal-impl";
import { flattenModules, loadSfr, resolveRef } from "./model";
import type { ProjectConfig } from "./types";

export interface FnRef {
  fn: string; // "UartHal::Init"
  access: "r" | "w" | "rw";
}

export interface TraceResult {
  project: string;
  ref: string;
  /** Class::Method -> registers it touches */
  fnTouches: Record<string, RegRef[]>;
  /** "<ip>::<reg>" -> HAL functions that touch it */
  regUsedBy: Record<string, FnRef[]>;
  /** number of .c/.cpp implementation files scanned */
  implFiles: number;
}

/**
 * Build the SFR↔HAL traceability index by scanning the HAL implementation sources
 * for register accesses and cross-referencing them with the SFR register model.
 */
export async function loadTrace(p: ProjectConfig, refInput?: string | null): Promise<TraceResult> {
  const halRepo = repoFor(p, "hal");
  const dir = await resolveRepoDir(halRepo);
  const ref = await resolveRef(p, refInput, "hal");
  const sha = await revParse(dir, ref);
  const sfr = await loadSfr(p, refInput);

  return diskCached(`trace:${dir}:${sha}:${sfr.sha}`, async () => {
    // IP register sets keyed by UPPERCASE name (the pointer alias the impl uses)
    const ipsByPtr = new Map<string, IpRegs>();
    for (const { ip, mod } of flattenModules(sfr)) {
      const key = ip.toUpperCase();
      let e = ipsByPtr.get(key);
      if (!e) {
        e = { name: ip, regs: new Set(), modulePath: new Map() };
        ipsByPtr.set(key, e);
      }
      for (const r of mod.regs) {
        e.regs.add(r.name);
        if (!e.modulePath.has(r.name)) e.modulePath.set(r.name, mod.path);
      }
    }

    const files = [
      ...(await listFilesAt(dir, sha, "", ".c")),
      ...(await listFilesAt(dir, sha, "", ".cpp")),
    ];
    const contents = await readFilesAt(dir, sha, files);

    const fnTouches: Record<string, RegRef[]> = {};
    const regUsedBy: Record<string, FnRef[]> = {};

    for (const f of files) {
      const scanned = scanHalImpl(contents.get(f) ?? "", ipsByPtr);
      for (const [fnKey, refs] of scanned) {
        // merge if a method appears across files (rare)
        fnTouches[fnKey] = mergeRefs(fnTouches[fnKey], refs);
        for (const a of refs) {
          const rk = `${a.ip}::${a.reg}`;
          (regUsedBy[rk] ??= []).push({ fn: fnKey, access: a.access });
        }
      }
    }
    // dedupe regUsedBy
    for (const k of Object.keys(regUsedBy)) {
      const seen = new Map<string, FnRef>();
      for (const r of regUsedBy[k]) seen.set(r.fn, { fn: r.fn, access: seen.has(r.fn) ? "rw" : r.access });
      regUsedBy[k] = [...seen.values()].sort((a, b) => a.fn.localeCompare(b.fn));
    }

    return { project: p.id, ref, fnTouches, regUsedBy, implFiles: files.length };
  });
}

function mergeRefs(existing: RegRef[] | undefined, add: RegRef[]): RegRef[] {
  if (!existing) return add;
  const byKey = new Map(existing.map((r) => [`${r.ip}::${r.reg}`, r]));
  for (const r of add) {
    const k = `${r.ip}::${r.reg}`;
    const prev = byKey.get(k);
    byKey.set(k, prev ? { ...r, access: prev.access === r.access ? r.access : "rw" } : r);
  }
  return [...byKey.values()].sort((a, b) => a.reg.localeCompare(b.reg));
}
