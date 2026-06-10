import { handle } from "@/lib/api";
import { readConfig } from "@/lib/config";
import { commitCount, listTags, recentCommits, resolveRepoDir } from "@/lib/git";
import { loadHal, loadSfr } from "@/lib/model";
import { computeHalStats, computeSfrStats } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const cfg = readConfig();
    const projects = await Promise.all(
      cfg.projects.map(async (p) => {
        try {
          const dir = await resolveRepoDir(p);
          const [tags, nCommits, commits, sfr, hal, sfrStats, halStats] = await Promise.all([
            listTags(dir),
            commitCount(dir),
            recentCommits(dir, 6),
            loadSfr(p),
            loadHal(p),
            computeSfrStats(p),
            computeHalStats(p),
          ]);
          const sfrLast = sfrStats.points[sfrStats.points.length - 1];
          const halLast = halStats.points[halStats.points.length - 1];
          return {
            id: p.id,
            name: p.name,
            codename: p.codename,
            description: p.description,
            status: "ok" as const,
            latestTag: tags[tags.length - 1]?.name ?? null,
            tagCount: tags.length,
            commitCount: nCommits,
            recentCommits: commits,
            baseline: sfrStats.baseline,
            totals: { ...sfr.totals, classes: hal.totals.classes, fns: hal.totals.fns },
            sfr: {
              reusePct: sfrLast?.reusePct ?? { regs: 100, fields: 100 },
              deltaPct: sfrLast?.deltaPct ?? { regs: 0, fields: 0 },
              spark: sfrStats.points.map((pt) => ({ x: pt.daysFromBaseline, y: pt.reusePct.regs, ref: pt.ref })),
              warnings: sfrStats.warnings,
            },
            hal: {
              reusePct: halLast?.reusePct ?? { fns: 100 },
              deltaPct: halLast?.deltaPct ?? { fns: 0 },
              spark: halStats.points.map((pt) => ({ x: pt.daysFromBaseline, y: pt.reusePct.fns, ref: pt.ref })),
              warnings: halStats.warnings,
            },
          };
        } catch (err) {
          return {
            id: p.id,
            name: p.name,
            codename: p.codename,
            description: p.description,
            status: "error" as const,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );
    return { projects };
  });
}
