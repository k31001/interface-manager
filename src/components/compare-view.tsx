"use client";

import { useMemo, useState } from "react";
import { fmtDate } from "@/lib/format";
import type { StatsResult } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ChartLegend, LineChart, ScatterChart } from "./charts";
import { IconWarn } from "./icons";
import { PageHeader } from "./shell";
import { Badge, Card, ErrorBox, SectionLabel, Select, Spinner, WarnBadge, cx } from "./ui";

interface ProjectMeta {
  id: string;
  name: string;
  codename?: string;
  description?: string;
}

const PALETTE = [
  { color: "#0a0a0a", marker: "circle" as const },
  { color: "#8a8a8a", marker: "square" as const },
  { color: "#404040", marker: "circle" as const },
];

type Metric = "sfr-regs" | "sfr-fields" | "hal-fns" | "combined";

export function CompareView({ projects }: { projects: ProjectMeta[] }) {
  const [metric, setMetric] = useState<Metric>("combined");

  const a = projects[0];
  const b = projects[1];

  const sfrA = useApi<StatsResult>(a ? `/api/projects/${a.id}/sfr/stats` : null);
  const sfrB = useApi<StatsResult>(b ? `/api/projects/${b.id}/sfr/stats` : null);
  const halA = useApi<StatsResult>(a ? `/api/projects/${a.id}/hal/stats` : null);
  const halB = useApi<StatsResult>(b ? `/api/projects/${b.id}/hal/stats` : null);

  const loading = sfrA.loading || sfrB.loading || halA.loading || halB.loading;
  const error = sfrA.error ?? sfrB.error ?? halA.error ?? halB.error;
  const ready = sfrA.data && sfrB.data && halA.data && halB.data;

  const series = useMemo(() => {
    if (!ready) return [];
    const defs = [
      { p: a, sfr: sfrA.data!, hal: halA.data!, pal: PALETTE[0] },
      { p: b, sfr: sfrB.data!, hal: halB.data!, pal: PALETTE[1] },
    ];
    const out = [];
    for (const d of defs) {
      const sfrPts = d.sfr.points.map((pt) => ({
        x: pt.daysFromBaseline,
        y: pt.reusePct.regs,
        label: `${d.p.name} ${pt.ref}`,
        warn: pt.warning?.dropPct,
      }));
      const fldPts = d.sfr.points.map((pt) => ({ x: pt.daysFromBaseline, y: pt.reusePct.fields, label: `${d.p.name} ${pt.ref}` }));
      const halPts = d.hal.points.map((pt) => ({
        x: pt.daysFromBaseline,
        y: pt.reusePct.fns,
        label: `${d.p.name} ${pt.ref}`,
        warn: pt.warning?.dropPct,
      }));
      if (metric === "sfr-regs" || metric === "combined")
        out.push({ id: `${d.p.id}-sfr`, label: `${d.p.name} · SFR registers`, color: d.pal.color, marker: d.pal.marker, points: sfrPts });
      if (metric === "sfr-fields")
        out.push({ id: `${d.p.id}-fld`, label: `${d.p.name} · SFR fields`, color: d.pal.color, marker: d.pal.marker, points: fldPts });
      if (metric === "hal-fns" || metric === "combined")
        out.push({
          id: `${d.p.id}-hal`,
          label: `${d.p.name} · HAL functions`,
          color: d.pal.color,
          marker: d.pal.marker,
          dashed: true,
          points: halPts,
        });
    }
    return out;
  }, [ready, metric, a, b, sfrA.data, sfrB.data, halA.data, halB.data]);

  const scatter = useMemo(() => {
    if (!ready) return [];
    return [
      { p: a, sfr: sfrA.data!, hal: halA.data!, pal: PALETTE[0], hollow: false },
      { p: b, sfr: sfrB.data!, hal: halB.data!, pal: PALETTE[1], hollow: true },
    ].map((d) => ({
      id: d.p.id,
      label: d.p.name,
      color: d.pal.color,
      hollow: d.hollow,
      points: d.sfr.points
        .map((pt, i) => {
          const h = d.hal.points[i];
          return h ? { x: pt.reusePct.regs, y: h.reusePct.fns, label: pt.ref } : null;
        })
        .filter(Boolean) as { x: number; y: number; label: string }[],
    }));
  }, [ready, a, b, sfrA.data, sfrB.data, halA.data, halB.data]);

  // Pearson correlation across all tags of both projects (SFR reg reuse vs HAL fn reuse)
  const correlation = useMemo(() => {
    const pts = scatter.flatMap((g) => g.points);
    if (pts.length < 3) return null;
    const n = pts.length;
    const mx = pts.reduce((s, q) => s + q.x, 0) / n;
    const my = pts.reduce((s, q) => s + q.y, 0) / n;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (const q of pts) {
      num += (q.x - mx) * (q.y - my);
      dx += (q.x - mx) ** 2;
      dy += (q.y - my) ** 2;
    }
    const denom = Math.sqrt(dx * dy);
    return denom ? num / denom : null;
  }, [scatter]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Project Compare"
        sub="reuse trajectories aligned on relative time — W0 is each project's initial import (baseline)"
      >
        <span className="text-[11px] text-neutral-400">metric</span>
        <Select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} className="w-56">
          <option value="combined">SFR registers + HAL functions</option>
          <option value="sfr-regs">SFR register reuse</option>
          <option value="sfr-fields">SFR field reuse</option>
          <option value="hal-fns">HAL function reuse</option>
        </Select>
      </PageHeader>

      <div className="flex-1 overflow-y-auto p-6">
        {error && <ErrorBox message={error} />}
        {loading && !ready && <Spinner label="Aligning timelines…" />}
        {projects.length < 2 && <ErrorBox message="Need at least two configured projects to compare." />}

        {ready && (
          <div className="fade-up mx-auto flex max-w-6xl flex-col gap-5">
            {/* headline cards */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {[
                { p: a, sfr: sfrA.data!, hal: halA.data!, pal: PALETTE[0] },
                { p: b, sfr: sfrB.data!, hal: halB.data!, pal: PALETTE[1] },
              ].map(({ p, sfr, hal, pal }) => {
                const sLast = sfr.points[sfr.points.length - 1];
                const hLast = hal.points[hal.points.length - 1];
                const worst = [...sfr.warnings].sort((x, y) => y.dropPct - x.dropPct)[0];
                return (
                  <Card key={p.id} className="p-4">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: pal.color }} />
                      <span className="text-sm font-semibold">{p.name}</span>
                      <span className="font-mono text-[10px] text-neutral-400">{p.codename}</span>
                      <span className="ml-auto font-mono text-[10px] text-neutral-400">
                        baseline {fmtDate(sfr.baseline.date)} · {sLast.daysFromBaseline}d
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-[11px] text-neutral-400">{p.description}</p>
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      <div>
                        <SectionLabel>SFR reg</SectionLabel>
                        <div className="mt-1 font-mono text-xl font-bold">{sLast.reusePct.regs.toFixed(1)}%</div>
                      </div>
                      <div>
                        <SectionLabel>SFR field</SectionLabel>
                        <div className="mt-1 font-mono text-xl font-bold">{sLast.reusePct.fields.toFixed(1)}%</div>
                      </div>
                      <div>
                        <SectionLabel>HAL fn</SectionLabel>
                        <div className="mt-1 font-mono text-xl font-bold">{hLast.reusePct.fns.toFixed(1)}%</div>
                      </div>
                    </div>
                    {worst && (
                      <div className="mt-3 flex items-center gap-2 rounded-md bg-red-50/70 px-2.5 py-1.5 text-[11px] text-red-700">
                        <IconWarn size={12} />
                        <span className="font-mono font-semibold">{worst.tag}</span>
                        <WarnBadge drop={worst.dropPct} />
                        <span className="truncate text-red-500">
                          {sfr.points.find((x) => x.ref === worst.tag)?.subject}
                        </span>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>

            {/* aligned trend chart */}
            <Card className="p-4">
              <div className="mb-1 flex flex-wrap items-center gap-4">
                <SectionLabel>Reuse vs relative time (weeks since each initial import)</SectionLabel>
                <div className="ml-auto">
                  <ChartLegend
                    items={series.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed, marker: s.marker }))}
                  />
                </div>
              </div>
              <LineChart
                series={series}
                height={320}
                yDomain={[60, 102]}
                fmtX={(x) => `W${Math.round(x / 7)}`}
                fmtY={(y) => `${Math.round(y)}%`}
                unit="%"
                xLabel="relative weeks"
              />
            </Card>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {/* correlation scatter */}
              <Card className="p-4">
                <SectionLabel className="mb-1">SFR reuse → HAL reuse correlation (per tag)</SectionLabel>
                <ScatterChart
                  groups={scatter}
                  height={260}
                  fmtX={(x) => `${Math.round(x)}%`}
                  fmtY={(y) => `${Math.round(y)}%`}
                  xTitle="SFR register reuse"
                  yTitle="HAL function reuse"
                />
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex items-center gap-4 text-[11px] text-neutral-600">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: PALETTE[0].color }} />
                      {a.name}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full border-[1.5px] bg-white" style={{ borderColor: PALETTE[1].color }} />
                      {b.name}
                    </span>
                  </div>
                  {correlation !== null && (
                    <Badge kind="dark" className="ml-auto">
                      pearson r = {correlation.toFixed(2)}
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
                  Each dot is one release tag; the dashed line is y = x. Points below it mean HAL function reuse trails
                  SFR register reuse at that tag{correlation !== null ? `, with overall coupling r = ${correlation.toFixed(2)}` : ""}.
                </p>
              </Card>

              {/* computed metrics comparison */}
              <Card className="p-4">
                <SectionLabel className="mb-2">Metrics · computed from tag history</SectionLabel>
                <CompareMetrics a={a} b={b} sfrA={sfrA.data!} sfrB={sfrB.data!} halA={halA.data!} halB={halB.data!} />
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Per-project metrics derived purely from the tag-history stats — no narrative. */
interface ProjectMetrics {
  sfrReg: number;
  sfrField: number;
  halFn: number;
  velocity: number; // pp of register reuse lost per 30 days, timeline-normalized
  drop: { pp: number; tag: string } | null; // largest single-tag register drop
  warnings: number;
  hotspot: { name: string; count: number } | null; // most-churned module across all tags
  spanDays: number;
  tagCount: number;
}

function deriveMetrics(sfr: StatsResult, hal: StatsResult): ProjectMetrics {
  const last = sfr.points[sfr.points.length - 1];
  const halLast = hal.points[hal.points.length - 1];

  // largest single-tag register-reuse drop
  let drop: { pp: number; tag: string } | null = null;
  for (const pt of sfr.points) {
    const d = -pt.deltaPct.regs;
    if (d > 0 && (!drop || d > drop.pp)) drop = { pp: Math.round(d * 10) / 10, tag: pt.ref };
  }

  // churn hotspot: sum topChanged counts by module basename across all tags
  const byModule = new Map<string, number>();
  for (const pt of sfr.points)
    for (const tc of pt.topChanged) {
      const name = tc.path.split("/").pop() ?? tc.path;
      byModule.set(name, (byModule.get(name) ?? 0) + tc.count);
    }
  let hotspot: { name: string; count: number } | null = null;
  for (const [name, count] of byModule) if (!hotspot || count > hotspot.count) hotspot = { name, count };

  const spanDays = last.daysFromBaseline || 1;
  const velocity = Math.round(((100 - last.reusePct.regs) / (spanDays / 30)) * 10) / 10;

  return {
    sfrReg: last.reusePct.regs,
    sfrField: last.reusePct.fields,
    halFn: halLast.reusePct.fns,
    velocity,
    drop,
    warnings: sfr.warnings.length,
    hotspot,
    spanDays,
    tagCount: sfr.points.length,
  };
}

function CompareMetrics({
  a,
  b,
  sfrA,
  sfrB,
  halA,
  halB,
}: {
  a: ProjectMeta;
  b: ProjectMeta;
  sfrA: StatsResult;
  sfrB: StatsResult;
  halA: StatsResult;
  halB: StatsResult;
}) {
  const mA = deriveMetrics(sfrA, halA);
  const mB = deriveMetrics(sfrB, halB);

  type Dir = "high" | "low" | "none";
  const rows: { label: string; a: string; b: string; na: number; nb: number; better: Dir }[] = [
    { label: "SFR register reuse", a: `${mA.sfrReg.toFixed(1)}%`, b: `${mB.sfrReg.toFixed(1)}%`, na: mA.sfrReg, nb: mB.sfrReg, better: "high" },
    { label: "SFR field reuse", a: `${mA.sfrField.toFixed(1)}%`, b: `${mB.sfrField.toFixed(1)}%`, na: mA.sfrField, nb: mB.sfrField, better: "high" },
    { label: "HAL function reuse", a: `${mA.halFn.toFixed(1)}%`, b: `${mB.halFn.toFixed(1)}%`, na: mA.halFn, nb: mB.halFn, better: "high" },
    { label: "Decline rate", a: `${mA.velocity.toFixed(1)} pp/mo`, b: `${mB.velocity.toFixed(1)} pp/mo`, na: mA.velocity, nb: mB.velocity, better: "low" },
    {
      label: "Largest single-tag drop",
      a: mA.drop ? `−${mA.drop.pp}pp · ${mA.drop.tag}` : "—",
      b: mB.drop ? `−${mB.drop.pp}pp · ${mB.drop.tag}` : "—",
      na: mA.drop?.pp ?? 0,
      nb: mB.drop?.pp ?? 0,
      better: "low",
    },
    { label: "Warning events", a: `${mA.warnings}`, b: `${mB.warnings}`, na: mA.warnings, nb: mB.warnings, better: "low" },
    {
      label: "Churn hotspot",
      a: mA.hotspot ? `${mA.hotspot.name} · ${mA.hotspot.count}` : "—",
      b: mB.hotspot ? `${mB.hotspot.name} · ${mB.hotspot.count}` : "—",
      na: 0,
      nb: 0,
      better: "none",
    },
    {
      label: "History span",
      a: `${mA.tagCount} tags · ${mA.spanDays}d`,
      b: `${mB.tagCount} tags · ${mB.spanDays}d`,
      na: 0,
      nb: 0,
      better: "none",
    },
  ];

  const win = (row: (typeof rows)[number], side: "a" | "b") => {
    if (row.better === "none" || row.na === row.nb) return false;
    const aWins = row.better === "high" ? row.na > row.nb : row.na < row.nb;
    return side === "a" ? aWins : !aWins;
  };

  return (
    <div className="overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] tracking-[0.08em] text-neutral-400 uppercase">
            <th className="pb-1.5 text-left font-medium">Metric</th>
            <th className="pb-1.5 pl-3 text-right font-medium">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: PALETTE[0].color }} />
                {a.name}
              </span>
            </th>
            <th className="pb-1.5 pl-3 text-right font-medium">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full border bg-white" style={{ borderColor: PALETTE[1].color }} />
                {b.name}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-neutral-100">
              <td className="py-1.5 text-neutral-500">{row.label}</td>
              <td className={cx("py-1.5 pl-3 text-right font-mono", win(row, "a") ? "font-semibold text-neutral-900" : "text-neutral-500")}>
                {row.a}
              </td>
              <td className={cx("py-1.5 pl-3 text-right font-mono", win(row, "b") ? "font-semibold text-neutral-900" : "text-neutral-500")}>
                {row.b}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2.5 text-[11px] leading-relaxed text-neutral-400">
        Decline rate normalizes lost register reuse over each project&apos;s own elapsed time (pp per 30 days), so
        timelines of different length stay comparable. Churn hotspot is the module accumulating the most non-doc changes
        across all tags.
      </p>
    </div>
  );
}
