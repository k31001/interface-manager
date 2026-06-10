/**
 * Verifies the seeded repos through the app's own parsers + stats engine:
 *  - parse every tag of both projects
 *  - print reuse trajectories
 *  - assert the intended storyline (Helios low reuse, Selene high reuse,
 *    exactly one warning-grade drop event each)
 */
import { readConfig } from "../src/lib/config";
import { loadHal, loadSfr } from "../src/lib/model";
import { computeHalStats, computeSfrStats } from "../src/lib/stats";

let failures = 0;
function check(cond: boolean, label: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ FAIL: ${label}`);
    failures++;
  }
}

async function main() {
  const cfg = readConfig();
  const results: Record<string, { sfrFinal: number; halFinal: number; sfrWarns: number; halWarns: number }> = {};

  for (const p of cfg.projects) {
    console.log(`\n=== ${p.name} (${p.id}) ===`);
    const [sfrModel, halModel] = await Promise.all([loadSfr(p), loadHal(p)]);
    console.log(
      `latest ${sfrModel.ref}: ${sfrModel.totals.modules} modules, ${sfrModel.totals.regs} regs, ${sfrModel.totals.fields} fields | HAL: ${halModel.totals.classes} classes, ${halModel.totals.fns} fns`
    );

    const [sfr, hal] = await Promise.all([computeSfrStats(p), computeHalStats(p)]);
    console.log(`\n  tag        date        day   reg%   fld%   fn%   Δreg   warn`);
    for (let i = 0; i < sfr.points.length; i++) {
      const s = sfr.points[i];
      const h = hal.points[i];
      console.log(
        `  ${s.ref.padEnd(10)} ${s.date.slice(0, 10)}  ${`${s.daysFromBaseline}`.padStart(3)}  ${`${s.reusePct.regs}`.padStart(5)}  ${`${s.reusePct.fields}`.padStart(5)}  ${`${h?.reusePct.fns ?? "-"}`.padStart(5)}  ${`${s.deltaPct.regs}`.padStart(5)}   ${s.warning ? "⚠ -" + s.warning.dropPct + "pp" : ""}`
      );
    }

    const last = sfr.points[sfr.points.length - 1];
    const lastHal = hal.points[hal.points.length - 1];
    results[p.id] = {
      sfrFinal: last.reusePct.regs,
      halFinal: lastHal.reusePct.fns,
      sfrWarns: sfr.warnings.length,
      halWarns: hal.warnings.length,
    };

    console.log("");
    check(sfr.points.length >= 7, `${p.id}: has ${sfr.points.length} tag points`);
    const monotonicish = sfr.points.every((pt, i) => i === 0 || pt.reusePct.regs <= sfr.points[i - 1].reusePct.regs + 0.01);
    check(monotonicish, `${p.id}: register reuse never increases`);
    check(sfr.warnings.length === 1, `${p.id}: exactly one SFR warning event (got ${sfr.warnings.length})`);
    if (sfr.warnings.length) {
      console.log(`    event: ${sfr.warnings[0].tag} drop -${sfr.warnings[0].dropPct}pp`);
    }
  }

  console.log("\n=== Storyline ===");
  const h = results["helios"];
  const s = results["selene"];
  check(h.sfrFinal >= 62 && h.sfrFinal <= 76, `Helios final register reuse ~69% (got ${h.sfrFinal}%)`);
  check(s.sfrFinal >= 86 && s.sfrFinal <= 95, `Selene final register reuse ~90% (got ${s.sfrFinal}%)`);
  check(s.sfrFinal - h.sfrFinal >= 12, `Selene SFR reuse clearly higher than Helios (+${(s.sfrFinal - h.sfrFinal).toFixed(1)}pp)`);
  check(h.halFinal >= 66 && h.halFinal <= 80, `Helios final HAL reuse ~74% (got ${h.halFinal}%)`);
  check(s.halFinal >= 89 && s.halFinal <= 97, `Selene final HAL reuse ~93% (got ${s.halFinal}%)`);
  check(s.halFinal - h.halFinal >= 10, `Selene HAL reuse clearly higher than Helios (+${(s.halFinal - h.halFinal).toFixed(1)}pp)`);

  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
