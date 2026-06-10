"use client";

import Link from "next/link";
import { useMemo } from "react";
import { fmtDate, timeAgo } from "@/lib/format";
import type { CommitInfo, StatsWarning } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Sparkline } from "./charts";
import { IconArrowRight, IconCommit, IconTag, IconWarn } from "./icons";
import { PageHeader } from "./shell";
import { Badge, Card, ErrorBox, SectionLabel, Spinner, WarnBadge, cx } from "./ui";

interface OverviewProject {
  id: string;
  name: string;
  codename?: string;
  description?: string;
  status: "ok" | "error";
  error?: string;
  latestTag: string | null;
  tagCount: number;
  commitCount: number;
  recentCommits: CommitInfo[];
  baseline: { ref: string; date: string };
  totals: { modules: number; regs: number; fields: number; classes: number; fns: number };
  sfr: {
    reusePct: { regs: number; fields: number };
    deltaPct: { regs: number };
    spark: { x: number; y: number; ref: string }[];
    warnings: StatsWarning[];
  };
  hal: {
    reusePct: { fns: number };
    spark: { x: number; y: number; ref: string }[];
    warnings: StatsWarning[];
  };
}

function ProjectCard({ p }: { p: OverviewProject }) {
  if (p.status === "error") {
    return (
      <Card className="p-4">
        <div className="text-sm font-semibold">{p.name}</div>
        <ErrorBox message={p.error ?? "failed to load"} />
      </Card>
    );
  }
  const warnings = [...p.sfr.warnings, ...p.hal.warnings];
  return (
    <Card hover className="fade-up flex flex-col p-4">
      <div className="flex items-baseline gap-2.5">
        <Link href={`/${p.id}/sfr`} className="text-[15px] font-bold tracking-tight hover:underline">
          {p.name}
        </Link>
        <span className="font-mono text-[10px] text-neutral-400">{p.codename}</span>
        <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10.5px] text-neutral-400">
          <IconTag size={11} />
          {p.latestTag} · {p.tagCount} tags · {p.commitCount} commits
        </span>
      </div>
      <p className="mt-1 line-clamp-1 text-[11.5px] text-neutral-400">{p.description}</p>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <SectionLabel>SFR register reuse</SectionLabel>
            <div className="mt-0.5 font-mono text-2xl font-bold tracking-tight">{p.sfr.reusePct.regs.toFixed(1)}%</div>
          </div>
          <Sparkline points={p.sfr.spark} width={110} height={36} />
        </div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <SectionLabel>HAL function reuse</SectionLabel>
            <div className="mt-0.5 font-mono text-2xl font-bold tracking-tight">{p.hal.reusePct.fns.toFixed(1)}%</div>
          </div>
          <Sparkline points={p.hal.spark} width={110} height={36} color="#737373" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Badge kind="outline">{p.totals.regs} regs</Badge>
        <Badge kind="outline">{p.totals.fields} fields</Badge>
        <Badge kind="outline">{p.totals.modules} modules</Badge>
        <Badge kind="outline">{p.totals.fns} HAL fns</Badge>
        <Badge kind="outline">{p.totals.classes} classes</Badge>
      </div>

      {warnings.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {warnings.map((w) => (
            <Link
              key={`${w.metric}-${w.tag}`}
              href={`/${p.id}/${w.metric === "function" ? "hal" : "sfr"}/stats`}
              className="flex items-center gap-2 rounded-md bg-red-50/70 px-2.5 py-1.5 text-[11px] text-red-700 transition-colors hover:bg-red-50"
            >
              <IconWarn size={12} />
              <span className="font-mono font-semibold">{w.tag}</span>
              <span className="text-red-400">{w.metric} reuse</span>
              <WarnBadge drop={w.dropPct} />
              <IconArrowRight size={11} className="ml-auto text-red-300" />
            </Link>
          ))}
        </div>
      )}

      <div className="mt-4 flex gap-2 border-t border-neutral-100 pt-3">
        {[
          { href: `/${p.id}/sfr`, label: "SFR map" },
          { href: `/${p.id}/sfr/changelog`, label: "SFR changelog" },
          { href: `/${p.id}/hal`, label: "HAL docs" },
          { href: `/${p.id}/sfr/stats`, label: "Statistics" },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-500 transition-all hover:border-neutral-900 hover:bg-neutral-900 hover:text-white"
          >
            {l.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}

export function DashboardView() {
  const { data, error, loading } = useApi<{ projects: OverviewProject[] }>("/api/overview");

  const feed = useMemo(() => {
    if (!data) return [];
    return data.projects
      .filter((p) => p.status === "ok")
      .flatMap((p) => p.recentCommits.map((c) => ({ ...c, project: p.name, projectId: p.id })))
      .sort((x, y) => y.date.localeCompare(x.date))
      .slice(0, 10);
  }, [data]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Overview" sub="SoC HW/SW interface health across projects" />
      <div className="flex-1 overflow-y-auto p-6">
        {error && <ErrorBox message={error} />}
        {loading && !data && <Spinner label="Collecting project status…" />}
        {data && (
          <div className="mx-auto flex max-w-6xl flex-col gap-5">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {data.projects.map((p) => (
                <ProjectCard key={p.id} p={p} />
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
              <Card className="fade-up overflow-hidden">
                <div className="border-b border-neutral-200 bg-neutral-50/60 px-4 py-2.5">
                  <SectionLabel>Recent activity</SectionLabel>
                </div>
                {feed.map((c) => (
                  <div key={c.sha} className="flex items-center gap-3 border-t border-neutral-100 px-4 py-2 first:border-0">
                    <IconCommit size={13} className="shrink-0 text-neutral-300" />
                    <span className="font-mono text-[10px] text-neutral-400">{c.sha.slice(0, 7)}</span>
                    <Badge kind="outline">{c.project}</Badge>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-neutral-700">{c.subject}</span>
                    <span className="text-[10.5px] whitespace-nowrap text-neutral-400">{c.author.split(" ")[0]}</span>
                    <span className="font-mono text-[10px] whitespace-nowrap text-neutral-300">{timeAgo(c.date)}</span>
                  </div>
                ))}
              </Card>

              <Card className="fade-up h-fit overflow-hidden">
                <div className="border-b border-neutral-200 bg-neutral-50/60 px-4 py-2.5">
                  <SectionLabel>Quick compare</SectionLabel>
                </div>
                <div className="flex flex-col gap-2 p-4">
                  {data.projects
                    .filter((p) => p.status === "ok")
                    .map((p) => (
                      <div key={p.id} className="flex items-center gap-2 text-xs">
                        <span className="w-14 font-medium">{p.name}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
                          <div
                            className={cx("h-full rounded-full transition-all duration-700", p.sfr.reusePct.regs > 85 ? "bg-neutral-900" : "bg-neutral-500")}
                            style={{ width: `${p.sfr.reusePct.regs}%` }}
                          />
                        </div>
                        <span className="w-12 text-right font-mono text-[11px] font-semibold">
                          {p.sfr.reusePct.regs.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  <p className="mt-1 text-[10.5px] leading-relaxed text-neutral-400">
                    SFR register reuse vs each project&apos;s baseline.
                  </p>
                  <Link
                    href="/compare"
                    className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-700"
                  >
                    Open full comparison <IconArrowRight size={12} />
                  </Link>
                </div>
              </Card>
            </div>

            {data.projects.every((p) => p.status === "ok") && (
              <p className="pb-2 text-center font-mono text-[10px] text-neutral-300">
                baselines: {data.projects.map((p) => `${p.name} ${p.baseline.ref} (${fmtDate(p.baseline.date)})`).join(" · ")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
