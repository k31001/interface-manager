"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { StatsResult } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ChartLegend, LineChart, type MarkerShape, MarkerSwatch, ScatterChart } from "./charts";
import { IconWarn } from "./icons";
import { PageHeader } from "./shell";
import { Badge, Card, ErrorBox, SectionLabel, Select, Spinner, WarnBadge, cx } from "./ui";

interface ProjectMeta {
  id: string;
  name: string;
  codename?: string;
  description?: string;
}

// distinct hue AND shape per project so series never look alike
const PALETTE: { color: string; marker: MarkerShape }[] = [
  { color: "#0a0a0a", marker: "circle" }, // black circle
  { color: "#0ea5e9", marker: "square" }, // sky square
  { color: "#f59e0b", marker: "triangle" }, // amber triangle
  { color: "#14b8a6", marker: "diamond" }, // teal diamond
  { color: "#8b5cf6", marker: "circle" }, // violet circle
  { color: "#ec4899", marker: "square" }, // pink square
];
const palOf = (i: number) => PALETTE[i % PALETTE.length];

type Metric = "sfr-regs" | "sfr-fields" | "hal-fns" | "combined";

interface Loaded {
  meta: ProjectMeta;
  sfr: StatsResult;
  hal: StatsResult;
  palIdx: number;
}

/** invisible per-project loader so each project's stats hooks live in their own component */
function StatsLoader({ id, onLoad }: { id: string; onLoad: (id: string, sfr: StatsResult, hal: StatsResult) => void }) {
  const sfr = useApi<StatsResult>(`/api/projects/${id}/sfr/stats`);
  const hal = useApi<StatsResult>(`/api/projects/${id}/hal/stats`);
  useEffect(() => {
    if (sfr.data && hal.data) onLoad(id, sfr.data, hal.data);
  }, [id, sfr.data, hal.data, onLoad]);
  return null;
}

export function CompareView({ projects }: { projects: ProjectMeta[] }) {
  const [metric, setMetric] = useState<Metric>("combined");
  const [selected, setSelected] = useState<string[]>(() => projects.slice(0, Math.min(3, projects.length)).map((p) => p.id));
  const [results, setResults] = useState<Record<string, { sfr: StatsResult; hal: StatsResult }>>({});

  const onLoad = useCallback((id: string, sfr: StatsResult, hal: StatsResult) => {
    setResults((prev) => (prev[id]?.sfr === sfr && prev[id]?.hal === hal ? prev : { ...prev, [id]: { sfr, hal } }));
  }, []);

  const toggle = (id: string) =>
    setSelected((prev) => {
      if (prev.includes(id)) return prev.length > 2 ? prev.filter((x) => x !== id) : prev; // keep ≥2
      return [...prev, id];
    });

  const ready: Loaded[] = projects
    .map((meta, i) => ({ meta, i }))
    .filter(({ meta }) => selected.includes(meta.id) && results[meta.id])
    .map(({ meta, i }) => ({ meta, sfr: results[meta.id].sfr, hal: results[meta.id].hal, palIdx: i }));

  const series = useMemo(() => {
    const out: { id: string; label: string; color: string; marker: MarkerShape; dashed?: boolean; points: { x: number; y: number; label?: string; warn?: number }[] }[] = [];
    for (const d of ready) {
      const pal = palOf(d.palIdx);
      const reg = d.sfr.points.map((pt) => ({ x: pt.daysFromBaseline, y: pt.reusePct.regs, label: `${d.meta.name} ${pt.ref}`, warn: pt.warning?.dropPct }));
      const fld = d.sfr.points.map((pt) => ({ x: pt.daysFromBaseline, y: pt.reusePct.fields, label: `${d.meta.name} ${pt.ref}` }));
      const fn = d.hal.points.map((pt) => ({ x: pt.daysFromBaseline, y: pt.reusePct.fns, label: `${d.meta.name} ${pt.ref}`, warn: pt.warning?.dropPct }));
      if (metric === "sfr-regs" || metric === "combined") out.push({ id: `${d.meta.id}-sfr`, label: `${d.meta.name} · SFR`, color: pal.color, marker: pal.marker, points: reg });
      if (metric === "sfr-fields") out.push({ id: `${d.meta.id}-fld`, label: `${d.meta.name} · SFR fields`, color: pal.color, marker: pal.marker, points: fld });
      if (metric === "hal-fns" || metric === "combined") out.push({ id: `${d.meta.id}-hal`, label: `${d.meta.name} · HAL`, color: pal.color, marker: pal.marker, dashed: true, points: fn });
    }
    return out;
  }, [ready, metric]);

  const scatter = useMemo(
    () =>
      ready.map((d) => ({
        id: d.meta.id,
        label: d.meta.name,
        color: palOf(d.palIdx).color,
        marker: palOf(d.palIdx).marker,
        points: d.sfr.points
          .map((pt, i) => (d.hal.points[i] ? { x: pt.reusePct.regs, y: d.hal.points[i].reusePct.fns, label: pt.ref } : null))
          .filter(Boolean) as { x: number; y: number; label: string }[],
      })),
    [ready]
  );

  const correlation = useMemo(() => {
    const pts = scatter.flatMap((g) => g.points);
    if (pts.length < 3) return null;
    const n = pts.length;
    const mx = pts.reduce((s, q) => s + q.x, 0) / n;
    const my = pts.reduce((s, q) => s + q.y, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (const q of pts) {
      num += (q.x - mx) * (q.y - my);
      dx += (q.x - mx) ** 2;
      dy += (q.y - my) ** 2;
    }
    const denom = Math.sqrt(dx * dy);
    return denom ? num / denom : null;
  }, [scatter]);

  const anyLoading = selected.some((id) => !results[id]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Project Compare" sub="reuse trajectories aligned on relative time — W0 is each project's initial import (baseline)">
        <span className="text-[11px] text-neutral-400">metric</span>
        <Select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} className="w-52">
          <option value="combined">SFR + HAL</option>
          <option value="sfr-regs">SFR register reuse</option>
          <option value="sfr-fields">SFR field reuse</option>
          <option value="hal-fns">HAL function reuse</option>
        </Select>
      </PageHeader>

      {/* invisible loaders for every configured project */}
      {projects.map((p) => (
        <StatsLoader key={p.id} id={p.id} onLoad={onLoad} />
      ))}

      <div className="flex-1 overflow-y-auto p-6">
        {projects.length < 2 ? (
          <ErrorBox message="Need at least two configured projects to compare." />
        ) : (
          <div className="mx-auto flex max-w-6xl flex-col gap-5">
            {/* project selector */}
            <div className="flex flex-wrap items-center gap-2">
              <SectionLabel className="mr-1">projects</SectionLabel>
              {projects.map((p, i) => {
                const on = selected.includes(p.id);
                const pal = palOf(i);
                return (
                  <button
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    className={cx(
                      "inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition-all duration-150",
                      on ? "border-neutral-900 bg-white text-neutral-900 shadow-[0_1px_4px_rgba(0,0,0,0.06)]" : "border-neutral-200 bg-neutral-50 text-neutral-400 hover:border-neutral-300"
                    )}
                  >
                    <MarkerSwatch shape={pal.marker} color={on ? pal.color : "#cbcbcb"} size={12} />
                    {p.name}
                    <span className="font-mono text-[9.5px] text-neutral-400">{p.codename}</span>
                  </button>
                );
              })}
              <span className="ml-1 text-[10.5px] text-neutral-400">{selected.length} selected · min 2</span>
            </div>

            {anyLoading && <Spinner label="Loading project statistics…" />}

            {ready.length >= 2 && (
              <>
                {/* headline cards */}
                <div className={cx("grid grid-cols-1 gap-3", ready.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3")}>
                  {ready.map((d) => {
                    const sLast = d.sfr.points[d.sfr.points.length - 1];
                    const hLast = d.hal.points[d.hal.points.length - 1];
                    const worst = [...d.sfr.warnings].sort((x, y) => y.dropPct - x.dropPct)[0];
                    const pal = palOf(d.palIdx);
                    return (
                      <Card key={d.meta.id} className="p-4">
                        <div className="flex items-center gap-2.5">
                          <MarkerSwatch shape={pal.marker} color={pal.color} size={13} />
                          <span className="text-sm font-semibold">{d.meta.name}</span>
                          <span className="font-mono text-[10px] text-neutral-400">{d.meta.codename}</span>
                          <span className="ml-auto font-mono text-[10px] text-neutral-400">{sLast.daysFromBaseline}d</span>
                        </div>
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
                      <ChartLegend items={series.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed, marker: s.marker }))} />
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
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-600">
                        {ready.map((d) => {
                          const pal = palOf(d.palIdx);
                          return (
                            <span key={d.meta.id} className="inline-flex items-center gap-1.5">
                              <MarkerSwatch shape={pal.marker} color={pal.color} size={12} />
                              {d.meta.name}
                            </span>
                          );
                        })}
                      </div>
                      {correlation !== null && (
                        <Badge kind="dark" className="ml-auto">
                          pearson r = {correlation.toFixed(2)}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
                      Each dot is one release tag; the dashed line is y = x. Points below it mean HAL function reuse trails SFR
                      register reuse at that tag.
                    </p>
                  </Card>

                  {/* computed metrics */}
                  <Card className="p-4">
                    <SectionLabel className="mb-2">Metrics · computed from tag history</SectionLabel>
                    <CompareMetrics rows={ready} />
                  </Card>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- algorithmic metrics (N projects) ----------------

interface ProjectMetrics {
  sfrReg: number;
  sfrField: number;
  halFn: number;
  velocity: number; // pp of register reuse lost per 30 days
  drop: { pp: number; tag: string } | null;
  warnings: number;
  hotspot: { name: string; count: number } | null;
  spanDays: number;
  tagCount: number;
}

function deriveMetrics(sfr: StatsResult, hal: StatsResult): ProjectMetrics {
  const last = sfr.points[sfr.points.length - 1];
  const halLast = hal.points[hal.points.length - 1];
  let drop: { pp: number; tag: string } | null = null;
  for (const pt of sfr.points) {
    const d = -pt.deltaPct.regs;
    if (d > 0 && (!drop || d > drop.pp)) drop = { pp: Math.round(d * 10) / 10, tag: pt.ref };
  }
  const byModule = new Map<string, number>();
  for (const pt of sfr.points)
    for (const tc of pt.topChanged) {
      const name = tc.path.split("/").pop() ?? tc.path;
      byModule.set(name, (byModule.get(name) ?? 0) + tc.count);
    }
  let hotspot: { name: string; count: number } | null = null;
  for (const [name, count] of byModule) if (!hotspot || count > hotspot.count) hotspot = { name, count };
  const spanDays = last.daysFromBaseline || 1;
  return {
    sfrReg: last.reusePct.regs,
    sfrField: last.reusePct.fields,
    halFn: halLast.reusePct.fns,
    velocity: Math.round(((100 - last.reusePct.regs) / (spanDays / 30)) * 10) / 10,
    drop,
    warnings: sfr.warnings.length,
    hotspot,
    spanDays,
    tagCount: sfr.points.length,
  };
}

function CompareMetrics({ rows }: { rows: Loaded[] }) {
  const ms = rows.map((d) => ({ d, m: deriveMetrics(d.sfr, d.hal) }));
  type Dir = "high" | "low" | "none";
  const defs: { label: string; fmt: (m: ProjectMetrics) => string; num: (m: ProjectMetrics) => number; better: Dir }[] = [
    { label: "SFR register reuse", fmt: (m) => `${m.sfrReg.toFixed(1)}%`, num: (m) => m.sfrReg, better: "high" },
    { label: "SFR field reuse", fmt: (m) => `${m.sfrField.toFixed(1)}%`, num: (m) => m.sfrField, better: "high" },
    { label: "HAL function reuse", fmt: (m) => `${m.halFn.toFixed(1)}%`, num: (m) => m.halFn, better: "high" },
    { label: "Decline rate", fmt: (m) => `${m.velocity.toFixed(1)} pp/mo`, num: (m) => m.velocity, better: "low" },
    { label: "Largest single-tag drop", fmt: (m) => (m.drop ? `−${m.drop.pp}pp · ${m.drop.tag}` : "—"), num: (m) => m.drop?.pp ?? 0, better: "low" },
    { label: "Warning events", fmt: (m) => `${m.warnings}`, num: (m) => m.warnings, better: "low" },
    { label: "Churn hotspot", fmt: (m) => (m.hotspot ? `${m.hotspot.name} · ${m.hotspot.count}` : "—"), num: () => 0, better: "none" },
    { label: "History span", fmt: (m) => `${m.tagCount} tags · ${m.spanDays}d`, num: () => 0, better: "none" },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] tracking-[0.08em] text-neutral-400 uppercase">
            <th className="pb-1.5 text-left font-medium">Metric</th>
            {ms.map(({ d }) => (
              <th key={d.meta.id} className="pb-1.5 pl-3 text-right font-medium whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">
                  <MarkerSwatch shape={palOf(d.palIdx).marker} color={palOf(d.palIdx).color} size={11} />
                  {d.meta.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {defs.map((def) => {
            const nums = ms.map(({ m }) => def.num(m));
            const best = def.better === "high" ? Math.max(...nums) : def.better === "low" ? Math.min(...nums) : NaN;
            const allEqual = nums.every((x) => x === nums[0]);
            return (
              <tr key={def.label} className="border-t border-neutral-100">
                <td className="py-1.5 text-neutral-500">{def.label}</td>
                {ms.map(({ d, m }) => {
                  const win = def.better !== "none" && !allEqual && def.num(m) === best;
                  return (
                    <td key={d.meta.id} className={cx("py-1.5 pl-3 text-right font-mono whitespace-nowrap", win ? "font-semibold text-neutral-900" : "text-neutral-500")}>
                      {def.fmt(m)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2.5 text-[11px] leading-relaxed text-neutral-400">
        Decline rate normalizes lost register reuse over each project&apos;s own elapsed time (pp per 30 days), so timelines
        of different length stay comparable. Churn hotspot is the module accumulating the most non-doc changes across all tags.
      </p>
    </div>
  );
}
