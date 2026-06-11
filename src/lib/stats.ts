import { diskCached } from "./cache";
import { baselineFor, dirFor, repoFor } from "./config";
import { diffHal, diffSfr, fieldFunctionallyEqual, regFunctionallyEqual } from "./diff";
import { refDate, resolveRepoDir, revParse } from "./git";
import { type Progress, flattenModules, loadHal, loadSfr, projectTags } from "./model";
import type {
  HalFn,
  HalModel,
  ProjectConfig,
  SfrModel,
  SfrReg,
  StatsPoint,
  StatsResult,
  StatsWarning,
} from "./types";

const DAY = 24 * 3600 * 1000;
const round1 = (n: number) => Math.round(n * 10) / 10;

function regKeyMap(model: SfrModel): Map<string, SfrReg> {
  const map = new Map<string, SfrReg>();
  for (const { mod } of flattenModules(model)) {
    for (const r of mod.regs) map.set(`${mod.path}::${r.name}`, r);
  }
  return map;
}

function fnKeyMap(model: HalModel): Map<string, HalFn> {
  const map = new Map<string, HalFn>();
  for (const f of model.files) for (const c of f.classes) for (const fn of c.fns) map.set(`${f.path}::${c.name}::${fn.name}`, fn);
  return map;
}

export async function computeSfrStats(p: ProjectConfig, baselineRef?: string, onProgress?: Progress): Promise<StatsResult> {
  const dir = await resolveRepoDir(repoFor(p, "sfr"));
  const baseRef = baselineRef || baselineFor(p, "sfr");
  const baseSha = await revParse(dir, baseRef);

  return diskCached(`sfrstats:${dir}:${baseSha}:${dirFor(p, "sfr")}:${p.warnThresholdPct}`, async () => {
    const tags = await projectTags(p, "sfr");
    const baseModel = await loadSfr(p, baseRef);
    const baseRegs = regKeyMap(baseModel);
    const baseDate = new Date(await refDate(dir, baseRef)).getTime();
    const baseFieldCount = [...baseRegs.values()].reduce((n, r) => n + r.fields.length, 0);

    const points: StatsPoint[] = [];
    const warnings: StatsWarning[] = [];
    let prevModel: SfrModel | null = null;

    const relevant = tags.filter((t) => new Date(t.date).getTime() >= baseDate);
    let ti = 0;
    for (const tag of relevant) {
      onProgress?.(++ti, relevant.length, tag.name);
      const tagDate = new Date(tag.date).getTime();
      const model = await loadSfr(p, tag.name);
      const curRegs = regKeyMap(model);

      let regUnchanged = 0;
      let fieldUnchanged = 0;
      for (const [key, baseReg] of baseRegs) {
        const cur = curRegs.get(key);
        if (!cur) continue;
        if (regFunctionallyEqual(baseReg, cur)) regUnchanged++;
        const curFields = new Map(cur.fields.map((f) => [f.name, f]));
        for (const bf of baseReg.fields) {
          const cf = curFields.get(bf.name);
          if (cf && fieldFunctionallyEqual(bf, cf)) fieldUnchanged++;
        }
      }

      const reuseRegs = baseRegs.size ? round1((regUnchanged / baseRegs.size) * 100) : 100;
      const reuseFields = baseFieldCount ? round1((fieldUnchanged / baseFieldCount) * 100) : 100;

      // change counts vs previous tag
      let counts = { added: 0, removed: 0, modified: 0, doc: 0 };
      let topChanged: { path: string; count: number }[] = [];
      if (prevModel) {
        const d = diffSfr(prevModel, model);
        counts = d.summary.regs;
        topChanged = d.modules
          .map((m) => ({ path: m.path, count: m.regs.filter((r) => r.status !== "doc").length }))
          .filter((m) => m.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);
      }

      const prev = points[points.length - 1];
      const deltaRegs = prev ? round1(reuseRegs - prev.reusePct.regs) : 0;
      const deltaFields = prev ? round1(reuseFields - prev.reusePct.fields) : 0;

      const point: StatsPoint = {
        ref: tag.name,
        sha: tag.sha,
        date: tag.date,
        subject: tag.subject,
        daysFromBaseline: Math.round((tagDate - baseDate) / DAY),
        total: { regs: model.totals.regs, fields: model.totals.fields, modules: model.totals.modules },
        unchanged: { regs: regUnchanged, fields: fieldUnchanged },
        reusePct: { regs: reuseRegs, fields: reuseFields },
        deltaPct: { regs: deltaRegs, fields: deltaFields },
        counts,
        topChanged,
      };

      if (prev && prev.reusePct.regs - reuseRegs >= p.warnThresholdPct) {
        const w: StatsWarning = {
          tag: tag.name,
          date: tag.date,
          metric: "register",
          dropPct: round1(prev.reusePct.regs - reuseRegs),
          prevTag: prev.ref,
        };
        point.warning = w;
        warnings.push(w);
      }

      points.push(point);
      prevModel = model;
    }

    return {
      project: p.id,
      kind: "sfr",
      baseline: { ref: baseRef, sha: baseSha, date: new Date(baseDate).toISOString() },
      baselineTotal: { regs: baseRegs.size, fields: baseFieldCount },
      points,
      warnings,
    } satisfies StatsResult;
  });
}

export async function computeHalStats(p: ProjectConfig, baselineRef?: string, onProgress?: Progress): Promise<StatsResult> {
  const dir = await resolveRepoDir(repoFor(p, "hal"));
  const baseRef = baselineRef || baselineFor(p, "hal");
  const baseSha = await revParse(dir, baseRef);

  return diskCached(`halstats:${dir}:${baseSha}:${dirFor(p, "hal")}:${p.warnThresholdPct}`, async () => {
    const tags = await projectTags(p, "hal");
    const baseModel = await loadHal(p, baseRef);
    const baseFns = fnKeyMap(baseModel);
    const baseDate = new Date(await refDate(dir, baseRef)).getTime();

    const points: StatsPoint[] = [];
    const warnings: StatsWarning[] = [];
    let prevModel: HalModel | null = null;

    const relevant = tags.filter((t) => new Date(t.date).getTime() >= baseDate);
    let ti = 0;
    for (const tag of relevant) {
      onProgress?.(++ti, relevant.length, tag.name);
      const tagDate = new Date(tag.date).getTime();
      const model = await loadHal(p, tag.name);
      const curFns = fnKeyMap(model);

      let unchanged = 0;
      for (const [key, baseFn] of baseFns) {
        const cur = curFns.get(key);
        if (cur && cur.key === baseFn.key) unchanged++;
      }
      const reuse = baseFns.size ? round1((unchanged / baseFns.size) * 100) : 100;

      let counts = { added: 0, removed: 0, modified: 0, doc: 0 };
      let topChanged: { path: string; count: number }[] = [];
      if (prevModel) {
        const d = diffHal(prevModel, model);
        counts = d.summary.fns;
        topChanged = d.files
          .map((f) => ({ path: f.rel, count: f.fns.filter((x) => x.status !== "doc").length }))
          .filter((f) => f.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);
      }

      const prev = points[points.length - 1];
      const point: StatsPoint = {
        ref: tag.name,
        sha: tag.sha,
        date: tag.date,
        subject: tag.subject,
        daysFromBaseline: Math.round((tagDate - baseDate) / DAY),
        total: { fns: model.totals.fns, classes: model.totals.classes },
        unchanged: { fns: unchanged },
        reusePct: { fns: reuse },
        deltaPct: { fns: prev ? round1(reuse - prev.reusePct.fns) : 0 },
        counts,
        topChanged,
      };

      if (prev && prev.reusePct.fns - reuse >= p.warnThresholdPct) {
        const w: StatsWarning = {
          tag: tag.name,
          date: tag.date,
          metric: "function",
          dropPct: round1(prev.reusePct.fns - reuse),
          prevTag: prev.ref,
        };
        point.warning = w;
        warnings.push(w);
      }

      points.push(point);
      prevModel = model;
    }

    return {
      project: p.id,
      kind: "hal",
      baseline: { ref: baseRef, sha: baseSha, date: new Date(baseDate).toISOString() },
      baselineTotal: { fns: baseFns.size },
      points,
      warnings,
    } satisfies StatsResult;
  });
}
