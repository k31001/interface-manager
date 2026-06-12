import { diskCached } from "./cache";
import { repoFor } from "./config";
import { diffReg } from "./diff";
import { resolveRepoDir, revParse } from "./git";
import { flattenModules, loadSfr, projectTags } from "./model";
import type { FieldDiff, PropChange, ProjectConfig, SfrReg } from "./types";

export type RegHistoryStatus = "initial" | "added" | "removed" | "modified" | "unchanged" | "absent";

export interface RegHistoryEntry {
  ref: string;
  date: string;
  subject: string;
  status: RegHistoryStatus;
  changes: PropChange[]; // register-level changes vs previous tag
  fields: FieldDiff[]; // field-level changes vs previous tag
  /** snapshot for added/removed (so the UI can show the shape) */
  snapshot?: SfrReg;
}

export interface RegHistory {
  project: string;
  modulePath: string;
  reg: string;
  entries: RegHistoryEntry[];
  /** tags where something actually changed (added/modified/removed) */
  changeCount: number;
}

/** Walk every SFR tag and report when a given register (and its fields) changed — git blame, by register. */
export async function regHistory(p: ProjectConfig, modulePath: string, regName: string): Promise<RegHistory> {
  const dir = await resolveRepoDir(repoFor(p, "sfr"));
  const tags = await projectTags(p, "sfr");
  const latest = tags[tags.length - 1];
  const sha = latest ? await revParse(dir, latest.name) : "none";

  return diskCached(`reghist:${dir}:${sha}:${tags.length}:${modulePath}:${regName}`, async () => {
    const entries: RegHistoryEntry[] = [];
    let prev: SfrReg | null = null;
    let prevExisted = false;
    let seen = false;

    for (const tag of tags) {
      const model = await loadSfr(p, tag.name);
      const mod = flattenModules(model).find((m) => m.mod.path === modulePath);
      const reg = mod?.mod.regs.find((r) => r.name === regName) ?? null;
      const exists = !!reg;

      let status: RegHistoryStatus;
      let changes: PropChange[] = [];
      let fields: FieldDiff[] = [];
      let snapshot: SfrReg | undefined;

      if (exists && !prevExisted) {
        status = seen ? "added" : "initial";
        snapshot = reg!;
      } else if (!exists && prevExisted) {
        status = "removed";
        snapshot = prev!;
      } else if (exists && prevExisted) {
        const d = diffReg(prev!, reg!);
        if (d.reg.length || d.fields.length) {
          status = "modified";
          changes = d.reg;
          fields = d.fields;
        } else {
          status = "unchanged";
        }
      } else {
        status = "absent";
      }

      if (exists) seen = true;
      entries.push({ ref: tag.name, date: tag.date, subject: tag.subject, status, changes, fields, snapshot });
      prev = reg;
      prevExisted = exists;
    }

    const changeCount = entries.filter((e) => e.status === "added" || e.status === "modified" || e.status === "removed").length;
    return { project: p.id, modulePath, reg: regName, entries, changeCount };
  });
}
