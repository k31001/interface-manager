"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { fmtDate } from "@/lib/format";
import type { StatsResult, TagInfo } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ChartLegend, LineChart } from "./charts";
import { IconWarn } from "./icons";
import { PageHeader } from "./shell";
import { TagSelect } from "./tag-select";
import { Badge, Card, DeltaText, ErrorBox, Kpi, SectionLabel, Spinner, WarnBadge, cx } from "./ui";

interface MetricDef {
  key: string; // key into reusePct
  label: string;
  color?: string;
  dashed?: boolean;
}

const KIND_CONFIG = {
  sfr: {
    title: "SFR Statistics",
    unitNoun: "registers",
    metrics: [
      { key: "regs", label: "Register reuse", color: "#0a0a0a" },
      { key: "fields", label: "Field reuse", color: "#a3a3a3" },
    ] as MetricDef[],
    totals: [
      { key: "regs", label: "registers" },
      { key: "fields", label: "fields" },
    ],
  },
  hal: {
    title: "HAL Statistics",
    unitNoun: "functions",
    metrics: [{ key: "fns", label: "Function reuse", color: "#0a0a0a" }] as MetricDef[],
    totals: [{ key: "fns", label: "functions" }],
  },
};

export function StatsView({ project, projectName, kind }: { project: string; projectName: string; kind: "sfr" | "hal" }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const cfg = KIND_CONFIG[kind];

  const baseline = sp.get("baseline");
  const { data: tagsData } = useApi<{ tags: TagInfo[] }>(`/api/projects/${project}/tags`);
  const { data: stats, error, loading } = useApi<StatsResult>(
    `/api/projects/${project}/${kind}/stats${baseline ? `?baseline=${encodeURIComponent(baseline)}` : ""}`
  );

  const setBaseline = (b: string | null) => {
    const q = new URLSearchParams(sp.toString());
    if (b) q.set("baseline", b);
    else q.delete("baseline");
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  // navigate to the changelog comparing the tag before `ref` → `ref`
  const openChangelog = (ref: string) => {
    if (!stats) return;
    const idx = stats.points.findIndex((pt) => pt.ref === ref);
    if (idx <= 0) return; // baseline has no predecessor to diff against
    const from = stats.points[idx - 1].ref;
    router.push(`/${project}/${kind}/changelog?from=${encodeURIComponent(from)}&to=${encodeURIComponent(ref)}`);
  };

  const series = useMemo(() => {
    if (!stats) return [];
    return cfg.metrics.map((m) => ({
      id: m.key,
      label: m.label,
      color: m.color,
      dashed: m.dashed,
      points: stats.points.map((pt) => ({
        x: pt.daysFromBaseline,
        y: pt.reusePct[m.key],
        label: pt.ref,
        warn: m.key === cfg.metrics[0].key && pt.warning ? pt.warning.dropPct : undefined,
      })),
    }));
  }, [stats, cfg]);

  const last = stats?.points[stats.points.length - 1];
  const primary = cfg.metrics[0].key;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={
          <>
            {cfg.title} <span className="ml-1 font-mono text-xs font-normal text-neutral-400">{projectName}</span>
          </>
        }
        sub={
          stats ? (
            <>
              baseline <span className="font-mono">{stats.baseline.ref}</span> · {fmtDate(stats.baseline.date)} ·{" "}
              {Object.entries(stats.baselineTotal)
                .map(([k, v]) => `${v} ${k}`)
                .join(" · ")}
            </>
          ) : (
            " "
          )
        }
      >
        <span className="text-[11px] text-neutral-400">baseline</span>
        {tagsData && (
          <TagSelect tags={tagsData.tags} value={baseline} allowLatest={false} onChange={setBaseline} />
        )}
      </PageHeader>

      <div className="flex-1 overflow-y-auto p-6">
        {error && <ErrorBox message={error} />}
        {loading && !stats && <Spinner label="Crunching tags…" />}
        {stats && last && (
          <div className="fade-up mx-auto flex max-w-6xl flex-col gap-5">
            {/* KPI row */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {cfg.metrics.map((m) => (
                <Kpi
                  key={m.key}
                  label={`${m.label} @ ${last.ref}`}
                  value={last.reusePct[m.key]}
                  unit="%"
                  decimals={1}
                  sub={
                    <>
                      <DeltaText value={last.deltaPct[m.key]} /> vs previous tag
                    </>
                  }
                />
              ))}
              <Kpi
                label={`current ${cfg.unitNoun}`}
                value={last.total[primary === "regs" ? "regs" : "fns"] ?? 0}
                sub={
                  <>
                    baseline {stats.baselineTotal[primary]} · unchanged {last.unchanged[primary]}
                  </>
                }
              />
              <Kpi
                label="warning events"
                value={stats.warnings.length}
                tone={stats.warnings.length ? "warn" : undefined}
                sub={<>{`drop ≥ threshold between consecutive tags`}</>}
              />
            </div>

            {/* trend chart */}
            <Card className="p-4">
              <div className="mb-1 flex flex-wrap items-center gap-4">
                <SectionLabel>Reuse trend vs baseline {stats.baseline.ref}</SectionLabel>
                <div className="ml-auto">
                  <ChartLegend
                    items={[
                      ...cfg.metrics.map((m) => ({ label: m.label, color: m.color, dashed: m.dashed })),
                      { label: "warning event", color: "#dc2626" },
                    ]}
                  />
                </div>
              </div>
              <LineChart
                series={series}
                height={280}
                yDomain={[Math.min(60, ...stats.points.map((pt) => pt.reusePct[primary] - 6)), 102]}
                fmtX={(x) => `W${Math.round(x / 7)}`}
                fmtY={(y) => `${Math.round(y)}%`}
                unit="%"
                xLabel="weeks since baseline"
                onPointClick={(p) => p.label && openChangelog(p.label)}
              />
            </Card>

            {/* warnings */}
            {stats.warnings.length > 0 && (
              <Card className="overflow-hidden border-red-200">
                <div className="flex items-center gap-2 border-b border-red-100 bg-red-50/60 px-4 py-2.5 text-red-700">
                  <IconWarn size={14} />
                  <span className="text-xs font-semibold">Sudden reuse drops</span>
                  <span className="text-[10.5px] text-red-400">change spike — review these releases</span>
                </div>
                {stats.points
                  .filter((pt) => pt.warning)
                  .map((pt) => (
                    <div key={pt.ref} className="flex flex-wrap items-center gap-3 border-t border-neutral-100 px-4 py-2.5 first:border-0">
                      <span className="font-mono text-[12.5px] font-bold">{pt.ref}</span>
                      <span className="font-mono text-[10.5px] text-neutral-400">{fmtDate(pt.date)}</span>
                      <WarnBadge drop={pt.warning!.dropPct} />
                      <span className="truncate text-[11.5px] text-neutral-500">{pt.subject}</span>
                      {pt.topChanged.length > 0 && (
                        <span className="ml-auto flex flex-wrap gap-1.5">
                          {pt.topChanged.map((m) => (
                            <Badge key={m.path} kind="modified">
                              {m.path.split("/").pop()} ·{m.count}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </div>
                  ))}
              </Card>
            )}

            {/* per-tag table */}
            <Card className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-[10px] tracking-[0.1em] text-neutral-400 uppercase">
                    <th className="px-4 py-2 font-medium">Tag</th>
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 text-right font-medium">Day</th>
                    {cfg.metrics.map((m) => (
                      <th key={m.key} className="py-2 pl-6 text-right font-medium">
                        {m.label}
                      </th>
                    ))}
                    <th className="py-2 pl-6 text-right font-medium">Δ</th>
                    <th className="py-2 pl-6 text-right font-medium">+ / − / ~</th>
                    <th className="py-2 pr-4 pl-6 text-left font-medium">Top changed</th>
                  </tr>
                </thead>
                <tbody>
                  {[...stats.points].reverse().map((pt, ri, arr) => {
                    const hasPrev = ri < arr.length - 1; // reversed: last element is the baseline
                    return (
                    <tr
                      key={pt.ref}
                      onClick={() => hasPrev && openChangelog(pt.ref)}
                      className={cx(
                        "border-b border-neutral-100 transition-colors last:border-0",
                        hasPrev ? "cursor-pointer hover:bg-neutral-100" : "hover:bg-neutral-50",
                        pt.warning && "bg-red-50/40"
                      )}
                    >
                      <td className="px-4 py-2 font-mono text-[11.5px] font-semibold whitespace-nowrap">
                        {pt.ref}
                        {pt.warning && <IconWarn size={11} className="mb-px ml-1.5 inline text-red-500" />}
                      </td>
                      <td className="py-2 font-mono text-[10.5px] text-neutral-400">{fmtDate(pt.date)}</td>
                      <td className="py-2 text-right font-mono text-[10.5px] text-neutral-400">D+{pt.daysFromBaseline}</td>
                      {cfg.metrics.map((m) => (
                        <td key={m.key} className="py-2 pl-6 text-right font-mono text-[11.5px] font-medium">
                          {pt.reusePct[m.key].toFixed(1)}%
                        </td>
                      ))}
                      <td className="py-2 pl-6 text-right font-mono text-[10.5px]">
                        <DeltaText value={pt.deltaPct[primary]} />
                      </td>
                      <td className="py-2 pl-6 text-right font-mono text-[10.5px] whitespace-nowrap">
                        <span className="text-emerald-600">+{pt.counts.added}</span>{" "}
                        <span className="text-red-600">−{pt.counts.removed}</span>{" "}
                        <span className="text-amber-600">~{pt.counts.modified}</span>
                      </td>
                      <td className="max-w-56 truncate py-2 pr-4 pl-6 font-mono text-[10px] text-neutral-400">
                        {pt.topChanged.map((m) => m.path.split("/").pop()).join(", ")}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
