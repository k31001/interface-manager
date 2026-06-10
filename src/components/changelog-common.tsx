"use client";

import { fmtDate } from "@/lib/format";
import type { DiffCounts, DiffStatus, StatsResult, TagInfo } from "@/lib/types";
import { IconSearch, IconArrowRight, IconSwap, IconTag, IconX } from "./icons";
import { TagSelect } from "./tag-select";
import { Badge, Btn, Card, SectionLabel, WarnBadge, cx } from "./ui";

export const ALL_STATUSES: DiffStatus[] = ["added", "removed", "modified", "doc"];

const statusChip: Record<DiffStatus, { label: string; active: string }> = {
  added: { label: "added", active: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  removed: { label: "removed", active: "border-red-300 bg-red-50 text-red-700" },
  modified: { label: "modified", active: "border-amber-300 bg-amber-50 text-amber-700" },
  doc: { label: "doc only", active: "border-neutral-300 bg-neutral-100 text-neutral-600" },
};

/** Status toggles + text search + result counter. Bounds what the virtual list renders. */
export function ChangelogToolbar({
  counts,
  active,
  onToggle,
  query,
  onQuery,
  shown,
  total,
  noun,
}: {
  counts: DiffCounts;
  active: Set<DiffStatus>;
  onToggle: (s: DiffStatus) => void;
  query: string;
  onQuery: (q: string) => void;
  shown: number;
  total: number;
  noun: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3">
      <div className="flex items-center gap-1.5">
        {ALL_STATUSES.map((s) => {
          const on = active.has(s);
          const n = counts[s];
          return (
            <button
              key={s}
              onClick={() => onToggle(s)}
              className={cx(
                "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 font-mono text-[10.5px] font-medium transition-all duration-150",
                on ? statusChip[s].active : "border-neutral-200 bg-white text-neutral-400 hover:border-neutral-300",
                n === 0 && "opacity-40"
              )}
            >
              <span className={cx("inline-block h-1.5 w-1.5 rounded-full", on ? "bg-current" : "bg-neutral-300")} />
              {statusChip[s].label}
              <span className="tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      <span className="relative ml-auto inline-flex items-center">
        <IconSearch size={12} className="absolute left-2 text-neutral-400" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={`Filter ${noun}…`}
          className="h-7 w-52 rounded-md border border-neutral-200 bg-white pr-7 pl-7 text-xs outline-none placeholder:text-neutral-400 focus:border-neutral-500"
        />
        {query && (
          <button onClick={() => onQuery("")} className="absolute right-2 cursor-pointer text-neutral-400 hover:text-neutral-700">
            <IconX size={12} />
          </button>
        )}
      </span>

      <span className="font-mono text-[11px] whitespace-nowrap text-neutral-400">
        {shown === total ? `${total}` : `${shown} / ${total}`} {noun}
      </span>
    </div>
  );
}

export function CountChips({ counts, noun }: { counts: DiffCounts; noun: string }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {counts.added > 0 && <Badge kind="added">+{counts.added} added</Badge>}
      {counts.removed > 0 && <Badge kind="removed">−{counts.removed} removed</Badge>}
      {counts.modified > 0 && <Badge kind="modified">~{counts.modified} modified</Badge>}
      {counts.doc > 0 && <Badge kind="doc">±{counts.doc} doc</Badge>}
      {counts.added + counts.removed + counts.modified + counts.doc === 0 && (
        <Badge kind="neutral">no {noun} changes</Badge>
      )}
    </span>
  );
}

export function RangeBar({
  tags,
  from,
  to,
  onChange,
}: {
  tags: TagInfo[];
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <TagSelect tags={tags} value={from} allowLatest={false} onChange={(t) => t && onChange(t, to)} />
      <IconArrowRight size={13} className="text-neutral-400" />
      <TagSelect tags={tags} value={to} allowLatest={false} onChange={(t) => t && onChange(from, t)} />
      <Btn onClick={() => onChange(to, from)} title="Swap">
        <IconSwap size={13} />
      </Btn>
    </span>
  );
}

/** Release timeline built from per-tag stats points (changes vs previous tag). */
export function ReleaseTimeline({
  stats,
  noun,
  selected,
  onSelect,
}: {
  stats: StatsResult;
  noun: string;
  selected?: { from: string; to: string };
  onSelect: (from: string, to: string) => void;
}) {
  const points = [...stats.points].reverse();
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-neutral-200 bg-neutral-50/60 px-4 py-2.5">
        <SectionLabel>Release timeline</SectionLabel>
      </div>
      <div className="relative flex flex-col">
        {points.map((pt, i) => {
          const prev = points[i + 1];
          const isSel = selected && selected.to === pt.ref && prev && selected.from === prev.ref;
          return (
            <button
              key={pt.ref}
              disabled={!prev}
              onClick={() => prev && onSelect(prev.ref, pt.ref)}
              className={cx(
                "group relative flex items-start gap-3 border-b border-neutral-100 px-4 py-2.5 text-left transition-colors last:border-0",
                prev && "cursor-pointer hover:bg-neutral-50",
                isSel && "bg-neutral-50"
              )}
            >
              {/* spine */}
              <span className="absolute top-0 bottom-0 left-[27.5px] w-px bg-neutral-200 group-first:top-4 group-last:bottom-auto group-last:h-4" />
              <span
                className={cx(
                  "relative z-10 mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border bg-white",
                  pt.warning ? "border-red-400" : isSel ? "border-neutral-900" : "border-neutral-300"
                )}
              >
                <span className={cx("h-1.5 w-1.5 rounded-full", pt.warning ? "bg-red-500" : isSel ? "bg-neutral-900" : "bg-neutral-300")} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <IconTag size={11} className="text-neutral-400" />
                  <span className="font-mono text-[12.5px] font-semibold">{pt.ref}</span>
                  <span className="font-mono text-[10.5px] text-neutral-400">{fmtDate(pt.date)} · D+{pt.daysFromBaseline}</span>
                  {pt.warning && <WarnBadge drop={pt.warning.dropPct} />}
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] text-neutral-500">{pt.subject}</span>
                {prev && (
                  <span className="mt-1.5 block">
                    <CountChips counts={pt.counts} noun={noun} />
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

export function ChangeLine({ prop, from, to }: { prop: string; from: string; to: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 font-mono text-[10.5px]">
      <span className="text-neutral-400">{prop}</span>
      <span className="rounded bg-red-50 px-1 text-red-700 line-through decoration-red-300">{from || "∅"}</span>
      <span className="text-neutral-300">→</span>
      <span className="rounded bg-emerald-50 px-1 text-emerald-700">{to || "∅"}</span>
    </span>
  );
}
