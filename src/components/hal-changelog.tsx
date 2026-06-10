"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { DiffStatus, FnDiff, HalDiff, StatsResult, TagInfo } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ALL_STATUSES, ChangeLine, ChangelogToolbar, RangeBar, ReleaseTimeline } from "./changelog-common";
import { PageHeader } from "./shell";
import { Empty, ErrorBox, Spinner, StatusBadge, cx } from "./ui";
import { type VRow, VirtualList } from "./virtual-list";

function FnDiffBody({ fd }: { fd: FnDiff }) {
  const functionalChanges = fd.changes.filter((c) => !c.docOnly);
  const docChanges = fd.changes.filter((c) => c.docOnly);
  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <StatusBadge status={fd.status} />
        <span className="font-mono text-[12px]">
          <span className="text-neutral-400">{fd.cls}::</span>
          <span className="font-bold">{fd.name}</span>
        </span>
        {docChanges.length > 0 && fd.status === "doc" && (
          <span className="font-mono text-[10px] text-neutral-400">{docChanges.map((c) => c.prop).join(", ")} updated</span>
        )}
      </div>

      {(fd.status === "modified" || fd.status === "added" || fd.status === "removed") && (
        <div className="mt-2 flex flex-col gap-1 font-mono text-[11px]">
          {fd.sigFrom === fd.sigTo && fd.sigTo ? (
            <div className="rounded-md bg-neutral-50 px-2.5 py-1.5 text-neutral-600">{fd.sigTo}</div>
          ) : (
            <>
              {fd.sigFrom && fd.status !== "added" && (
                <div className={cx("rounded-md px-2.5 py-1.5", fd.status === "removed" ? "bg-red-50 text-red-800" : "bg-red-50/70 text-red-800")}>
                  <span className="mr-2 font-bold select-none">−</span>
                  {fd.sigFrom}
                </div>
              )}
              {fd.sigTo && fd.status !== "removed" && (
                <div className="rounded-md bg-emerald-50/70 px-2.5 py-1.5 text-emerald-800">
                  <span className="mr-2 font-bold select-none">+</span>
                  {fd.sigTo}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {functionalChanges.length > 0 && fd.status === "modified" && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-1">
          {functionalChanges.map((c, i) => (
            <ChangeLine key={i} prop={c.prop} from={c.from} to={c.to} />
          ))}
        </div>
      )}
    </div>
  );
}

export function HalChangelog({ project, projectName }: { project: string; projectName: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const { data: tagsData } = useApi<{ tags: TagInfo[] }>(`/api/projects/${project}/tags`);
  const { data: stats } = useApi<StatsResult>(`/api/projects/${project}/hal/stats`);

  const tags = tagsData?.tags ?? [];
  const latest = tags[tags.length - 1]?.name;
  const prev = tags[tags.length - 2]?.name ?? latest;
  const from = sp.get("from") ?? prev;
  const to = sp.get("to") ?? latest;

  const { data: diff, error, loading } = useApi<HalDiff>(
    from && to ? `/api/projects/${project}/hal/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : null
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
      return n.size ? n : new Set(ALL_STATUSES);
    });

  const { rows, shown, total } = useMemo(() => {
    if (!diff) return { rows: [] as VRow[], shown: 0, total: 0 };
    const q = query.trim().toLowerCase();
    const fnMatch = (fd: FnDiff) =>
      active.has(fd.status) && (!q || fd.name.toLowerCase().includes(q) || fd.cls.toLowerCase().includes(q));

    let total = 0;
    let shown = 0;
    for (const f of diff.files) for (const fd of f.fns) {
      total++;
      if (fnMatch(fd)) shown++;
    }

    const rows: VRow[] = [];
    for (const f of diff.files) {
      const fns = f.fns.filter(fnMatch);
      if (!fns.length) continue;
      rows.push({
        key: `file:${f.path}`,
        estimate: 38,
        node: (
          <div className="flex flex-wrap items-center gap-2.5 rounded-t-lg border border-b-0 border-neutral-200 bg-neutral-50/60 px-4 py-2">
            <span className="font-mono text-[11.5px] font-semibold text-neutral-700">{f.rel}</span>
            {f.status !== "modified" && <StatusBadge status={f.status} />}
            <span className="ml-auto font-mono text-[10px] text-neutral-400">
              {fns.length} change{fns.length > 1 ? "s" : ""}
            </span>
          </div>
        ),
      });
      fns.forEach((fd, i) => {
        const last = i === fns.length - 1;
        rows.push({
          key: `fn:${f.path}:${fd.cls}::${fd.name}:${fd.status}`,
          estimate: fd.status === "modified" || fd.status === "added" || fd.status === "removed" ? 96 : 48,
          node: (
            <div
              className={cx(
                "border-x border-neutral-200 bg-white",
                i > 0 && "border-t border-t-neutral-100",
                last && "rounded-b-lg border-b mb-3"
              )}
            >
              <FnDiffBody fd={fd} />
            </div>
          ),
        });
      });
    }
    return { rows, shown, total };
  }, [diff, active, query]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={
          <>
            HAL Changelog <span className="ml-1 font-mono text-xs font-normal text-neutral-400">{projectName}</span>
          </>
        }
        sub={diff ? <>comparing <span className="font-mono">{diff.from}</span> → <span className="font-mono">{diff.to}</span></> : " "}
      >
        {tags.length > 0 && from && to && <RangeBar tags={tags} from={from} to={to} onChange={setRange} />}
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-6 p-6 xl:flex-row">
        <div className="w-full overflow-y-auto xl:w-[340px] xl:shrink-0">
          {stats ? (
            <ReleaseTimeline stats={stats} noun="function" selected={{ from: from ?? "", to: to ?? "" }} onSelect={setRange} />
          ) : (
            <Spinner />
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {error && <ErrorBox message={error} />}
          {loading && !diff && <Spinner label="Computing diff…" />}
          {diff && (
            <>
              <ChangelogToolbar
                counts={diff.summary.fns}
                active={active}
                onToggle={toggle}
                query={query}
                onQuery={setQuery}
                shown={shown}
                total={total}
                noun="functions"
              />
              {rows.length === 0 ? (
                <Empty>{total === 0 ? "No API changes between these tags." : "No functions match the current filter."}</Empty>
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
