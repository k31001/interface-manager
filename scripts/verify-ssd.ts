import { computeHalStats, computeSfrStats } from "../src/lib/stats";
import { loadHal, loadSfr } from "../src/lib/model";
import type { ProjectConfig } from "../src/lib/types";

const p: ProjectConfig = {
  id: "pulsar", name: "Pulsar", repo: process.argv[2] ?? "/Users/euihyeokkwon/Works/pulsar",
  rdlDir: "rdl", halDir: "hal/include", baseline: "v0.1.0", warnThresholdPct: 4,
};

(async () => {
  const sfr = await loadSfr(p), hal = await loadHal(p);
  console.log(`latest ${sfr.ref}: ${sfr.totals.modules} modules, ${sfr.totals.regs} regs, ${sfr.totals.fields} fields | HAL ${hal.totals.files} files, ${hal.totals.classes} classes, ${hal.totals.fns} fns`);
  const ss = await computeSfrStats(p), hs = await computeHalStats(p);
  console.log("\n tag       date        day  reg%   fld%   fn%   Dreg  warn");
  ss.points.forEach((s, i) => {
    const h = hs.points[i];
    console.log(` ${s.ref.padEnd(8)} ${s.date.slice(0,10)} ${String(s.daysFromBaseline).padStart(4)} ${String(s.reusePct.regs).padStart(5)} ${String(s.reusePct.fields).padStart(6)} ${String(h?.reusePct.fns??"-").padStart(6)} ${String(s.deltaPct.regs).padStart(6)}  ${s.warning?"WARN -"+s.warning.dropPct+"pp":""}`);
  });
  const mono = ss.points.every((pt,i)=>i===0||pt.reusePct.regs<=ss.points[i-1].reusePct.regs+0.01);
  console.log(`\nmonotonic(reg): ${mono}  | SFR warnings: ${ss.warnings.length} (${ss.warnings.map(w=>w.tag+" -"+w.dropPct+"pp").join(", ")})  | HAL warnings: ${hs.warnings.length} (${hs.warnings.map(w=>w.tag+" -"+w.dropPct+"pp").join(", ")})`);
  const last = ss.points.at(-1)!, lh = hs.points.at(-1)!;
  console.log(`final: SFR reg ${last.reusePct.regs}% / field ${last.reusePct.fields}% , HAL ${lh.reusePct.fns}%`);
})();
