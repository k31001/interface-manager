"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { bitsLabel, hex } from "@/lib/format";
import type { DiffStatus, FieldDiff, RegDiff, SfrDiff, StatsResult, TagInfo } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ALL_STATUSES, ChangeLine, ChangelogToolbar, CountChips, RangeBar, ReleaseTimeline } from "./changelog-common";
import { PageHeader } from "./shell";
import { Empty, ErrorBox, SectionLabel, Spinner, StatusBadge, cx } from "./ui";
import { type VRow, VirtualList } from "./virtual-list";

function FieldDiffRow({ fd }: { fd: FieldDiff }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 py-1.5 pl-8">
      <StatusBadge status={fd.status} />
      <span className="font-mono text-[11.5px] font-medium">{fd.name}</span>
      {fd.bits && <span className="font-mono text-[10px] text-neutral-400">{fd.bits}</span>}
      <span className="flex flex-wrap gap-x-3 gap-y-1">
        {fd.changes
          .filter((c) => c.prop !== "desc")
          .map((c, i) => (
            <ChangeLine key={i} prop={c.prop} from={c.from} to={c.to} />
          ))}
        {fd.changes.some((c) => c.prop === "desc") && (
          <span className="font-mono text-[10px] text-neutral-400">description updated</span>
        )}
      </span>
    </div>
  );
}

function RegDiffBody({ rd }: { rd: RegDiff }) {
  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <StatusBadge status={rd.status} />
        <span className="font-mono text-[12.5px] font-bold">{rd.name}</span>
        <span className="font-mono text-[10px] text-neutral-400">{hex(rd.offset, 4)}</span>
        {(rd.status === "added" || rd.status === "removed") && rd.snapshot && (
          <span className="text-[11px] text-neutral-400">
            {rd.snapshot.fields.length} fields:{" "}
            <span className="font-mono text-[10.5px]">
              {rd.snapshot.fields
                .slice()
                .sort((a, b) => b.msb - a.msb)
                .map((f) => `${f.name}${bitsLabel(f.msb, f.lsb)}`)
                .join(" · ")}
            </span>
          </span>
        )}
        <span className="ml-auto flex flex-wrap gap-x-3">
          {rd.changes
            .filter((c) => c.prop !== "desc")
            .map((c, i) => (
              <ChangeLine key={i} prop={c.prop} from={c.from} to={c.to} />
            ))}
        </span>
      </div>
      {rd.fields.length > 0 && (
        <div className="mt-1.5">
          {rd.fields.map((fd) => (
            <FieldDiffRow key={`${fd.name}-${fd.status}`} fd={fd} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SfrChangelog({ project, projectName }: { project: string; projectName: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const { data: tagsData } = useApi<{ tags: TagInfo[] }>(`/api/projects/${project}/tags`);
  const { data: stats } = useApi<StatsResult>(`/api/projects/${project}/sfr/stats`);

  const tags = tagsData?.tags ?? [];
  const latest = tags[tags.length - 1]?.name;
  const prev = tags[tags.length - 2]?.name ?? latest;
  const from = sp.get("from") ?? prev;
  const to = sp.get("to") ?? latest;

  const { data: diff, error, loading } = useApi<SfrDiff>(
    from && to ? `/api/projects/${project}/sfr/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : null
  );

  const [active, setActive] = useState<Set<DiffStatus>>(new Set(ALL_STATUSES));
  const [query, setQuery] = useState("");

  const setRange = (f: string, t: string) => {
    const q = new URLSearchParams(sp.toString());
    q.set("from", f);
    q.set("to", t);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const toggle = (s: DiffStatus) =>
    setActive((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n.size ? n : new Set(ALL_STATUSES); // never empty
    });

  // flatten the (filtered) diff into windowed rows, grouped by subsystem → module → register
  const { rows, shown, total } = useMemo(() => {
    if (!diff) return { rows: [] as VRow[], shown: 0, total: 0 };
    const q = query.trim().toLowerCase();
    const regMatch = (rd: RegDiff) =>
      active.has(rd.status) &&
      (!q || rd.name.toLowerCase().includes(q) || rd.fields.some((f) => f.name.toLowerCase().includes(q)));

    const bySub = new Map<string, typeof diff.modules>();
    for (const m of diff.modules) {
      if (!bySub.has(m.subsystem)) bySub.set(m.subsystem, []);
      bySub.get(m.subsystem)!.push(m);
    }

    let total = 0;
    let shown = 0;
    for (const m of diff.modules) for (const rd of m.regs) {
      total++;
      if (regMatch(rd)) shown++;
    }

    const rows: VRow[] = [];
    for (const [sub, mods] of bySub) {
      const visibleMods = mods
        .map((m) => ({ m, regs: m.regs.filter(regMatch) }))
        .filter((x) => x.regs.length > 0);
      if (!visibleMods.length) continue;
      rows.push({
        key: `sub:${sub}`,
        estimate: 30,
        node: <SectionLabel className="pt-4 pb-1.5">{sub}</SectionLabel>,
      });
      for (const { m, regs } of visibleMods) {
        rows.push({
          key: `mod:${m.path}`,
          estimate: 38,
          node: (
            <div
              className={cx(
                "flex flex-wrap items-center gap-2.5 rounded-t-lg border border-b-0 border-neutral-200 px-4 py-2",
                m.status === "added" ? "bg-emerald-50/50" : m.status === "removed" ? "bg-red-50/50" : "bg-neutral-50/60"
              )}
            >
              <span className="font-mono text-[11.5px] font-semibold text-neutral-700">
                {m.ip} / {m.path.split("/").pop()}
              </span>
              {m.status !== "modified" && <StatusBadge status={m.status} />}
              <span className="ml-auto font-mono text-[10px] text-neutral-400">
                {regs.length} register{regs.length > 1 ? "s" : ""}
              </span>
            </div>
          ),
        });
        regs.forEach((rd, i) => {
          const last = i === regs.length - 1;
          rows.push({
            key: `reg:${m.path}:${rd.name}:${rd.status}`,
            estimate: 46 + rd.fields.length * 26,
            node: (
              <div
                className={cx(
                  "border-x border-neutral-200 bg-white",
                  i > 0 && "border-t border-t-neutral-100",
                  last && "rounded-b-lg border-b mb-3"
                )}
              >
                <RegDiffBody rd={rd} />
              </div>
            ),
          });
        });
      }
    }
    return { rows, shown, total };
  }, [diff, active, query]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={
          <>
            SFR Changelog <span className="ml-1 font-mono text-xs font-normal text-neutral-400">{projectName}</span>
          </>
        }
        sub={diff ? <>comparing <span className="font-mono">{diff.from}</span> → <span className="font-mono">{diff.to}</span></> : " "}
      >
        {tags.length > 0 && from && to && <RangeBar tags={tags} from={from} to={to} onChange={setRange} />}
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-6 p-6 xl:flex-row">
        <div className="w-full overflow-y-auto xl:w-[340px] xl:shrink-0">
          {stats ? (
            <ReleaseTimeline stats={stats} noun="register" selected={{ from: from ?? "", to: to ?? "" }} onSelect={setRange} />
          ) : (
            <Spinner />
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {error && <ErrorBox message={error} />}
          {loading && !diff && <Spinner label="Computing diff…" />}
          {diff && (
            <>
              <div className="flex items-center gap-2 pb-2">
                <SectionLabel>fields</SectionLabel>
                <CountChips counts={diff.summary.fields} noun="field" />
              </div>
              <ChangelogToolbar
                counts={diff.summary.regs}
                active={active}
                onToggle={toggle}
                query={query}
                onQuery={setQuery}
                shown={shown}
                total={total}
                noun="registers"
              />
              {rows.length === 0 ? (
                <Empty>{total === 0 ? "No interface changes between these tags." : "No registers match the current filter."}</Empty>
              ) : (
                <VirtualList rows={rows} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
