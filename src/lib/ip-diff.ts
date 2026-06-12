import { diskCached } from "./cache";
import { repoFor } from "./config";
import { diffReg } from "./diff";
import { resolveRepoDir, revParse } from "./git";
import { flattenModules, loadSfr, resolveRef } from "./model";
import type { DiffCounts, FieldDiff, PropChange, ProjectConfig, SfrModule, SfrReg } from "./types";

export interface IpRegDiff {
  name: string;
  status: "added" | "removed" | "modified" | "doc" | "same";
  offset: number;
  changes: PropChange[];
  fields: FieldDiff[];
  snapshot?: SfrReg;
}
export interface IpModuleDiff {
  file: string;
  status: "added" | "removed" | "common";
  regs: IpRegDiff[];
}
export interface IpDiffResult {
  a: { project: string; ref: string };
  b: { project: string; ref: string };
  ip: string;
  modules: IpModuleDiff[];
  summary: { regs: DiffCounts; fields: DiffCounts };
  /** IP names present in both projects (for the selector) */
  commonIps?: string[];
}

const empty = (): DiffCounts => ({ added: 0, removed: 0, modified: 0, doc: 0 });

type FlatMod = { system: string; subsystem: string; ip: string; mod: SfrModule };
const ipModules = (flat: FlatMod[], ip: string): SfrModule[] => flat.filter((m) => m.ip === ip).map((m) => m.mod);

/** Diff one IP between two projects, matching modules by file name and registers by name. */
export async function loadIpDiff(pa: ProjectConfig, pb: ProjectConfig, ip: string): Promise<IpDiffResult> {
  const [da, db] = await Promise.all([resolveRepoDir(repoFor(pa, "sfr")), resolveRepoDir(repoFor(pb, "sfr"))]);
  const [ra, rb] = await Promise.all([resolveRef(pa, null, "sfr"), resolveRef(pb, null, "sfr")]);
  const [sa, sb] = await Promise.all([revParse(da, ra), revParse(db, rb)]);

  return diskCached(`ipdiff:${da}:${sa}:${db}:${sb}:${ip}`, async () => {
    const [ma, mb] = await Promise.all([loadSfr(pa), loadSfr(pb)]);
    const fa = flattenModules(ma);
    const fb = flattenModules(mb);
    const commonIps = [...new Set(fa.map((m) => m.ip))].filter((name) => fb.some((m) => m.ip === name)).sort();

    const modsA = ipModules(fa, ip);
    const modsB = ipModules(fb, ip);
    const aByFile = new Map(modsA.map((m) => [m.file, m]));
    const bByFile = new Map(modsB.map((m) => [m.file, m]));
    const files = [...new Set([...aByFile.keys(), ...bByFile.keys()])].sort();

    const regCounts = empty();
    const fieldCounts = empty();
    const modules: IpModuleDiff[] = [];

    for (const file of files) {
      const a = aByFile.get(file);
      const b = bByFile.get(file);
      const md: IpModuleDiff = { file, status: !a ? "added" : !b ? "removed" : "common", regs: [] };

      if (!a || !b) {
        const mod = (a ?? b)!;
        for (const r of mod.regs) {
          md.regs.push({ name: r.name, status: !a ? "added" : "removed", offset: r.offset, changes: [], fields: [], snapshot: r });
          regCounts[!a ? "added" : "removed"]++;
          fieldCounts[!a ? "added" : "removed"] += r.fields.length;
        }
        modules.push(md);
        continue;
      }

      const aRegs = new Map(a.regs.map((r) => [r.name, r]));
      const bRegs = new Map(b.regs.map((r) => [r.name, r]));
      for (const [name, br] of bRegs) {
        const ar = aRegs.get(name);
        if (!ar) {
          md.regs.push({ name, status: "added", offset: br.offset, changes: [], fields: [], snapshot: br });
          regCounts.added++;
          fieldCounts.added += br.fields.length;
        } else {
          const d = diffReg(ar, br);
          if (d.reg.length || d.fields.length) {
            const functional = d.reg.some((c) => !c.docOnly) || d.fields.some((f) => f.status !== "doc");
            md.regs.push({ name, status: functional ? "modified" : "doc", offset: br.offset, changes: d.reg, fields: d.fields, snapshot: br });
            regCounts[functional ? "modified" : "doc"]++;
            for (const f of d.fields) {
              if (f.status === "added") fieldCounts.added++;
              else if (f.status === "removed") fieldCounts.removed++;
              else if (f.status === "modified") fieldCounts.modified++;
              else fieldCounts.doc++;
            }
          } else {
            md.regs.push({ name, status: "same", offset: br.offset, changes: [], fields: [], snapshot: br });
          }
        }
      }
      for (const [name, ar] of aRegs) {
        if (!bRegs.has(name)) {
          md.regs.push({ name, status: "removed", offset: ar.offset, changes: [], fields: [], snapshot: ar });
          regCounts.removed++;
          fieldCounts.removed += ar.fields.length;
        }
      }
      md.regs.sort((x, y) => x.offset - y.offset);
      modules.push(md);
    }

    return {
      a: { project: pa.id, ref: ra },
      b: { project: pb.id, ref: rb },
      ip,
      modules,
      summary: { regs: regCounts, fields: fieldCounts },
      commonIps,
    } satisfies IpDiffResult;
  });
}

/** Cheap: just the IP names present in both projects (for populating the selector). */
export async function commonIps(pa: ProjectConfig, pb: ProjectConfig): Promise<string[]> {
  const [ma, mb] = await Promise.all([loadSfr(pa), loadSfr(pb)]);
  const a = new Set(flattenModules(ma).map((m) => m.ip));
  return [...new Set(flattenModules(mb).map((m) => m.ip))].filter((ip) => a.has(ip)).sort();
}
