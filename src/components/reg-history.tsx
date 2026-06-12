"use client";

import { useRouter } from "next/navigation";
import { bitsLabel, fmtDate } from "@/lib/format";
import type { RegHistory as RegHistoryData, RegHistoryEntry } from "@/lib/history";
import { useApi } from "@/lib/use-api";
import { ChangeLine } from "./changelog-common";
import { IconTag } from "./icons";
import { Badge, Spinner, StatusBadge, cx } from "./ui";

const STATUS_LABEL: Record<string, string> = {
  initial: "introduced",
  added: "added",
  removed: "removed",
  modified: "modified",
};

function FieldChange({ fd }: { fd: RegHistoryEntry["fields"][number] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 pl-3">
      <StatusBadge status={fd.status} />
      <span className="font-mono text-[11px] font-medium">{fd.name}</span>
      {fd.bits && <span className="font-mono text-[10px] text-neutral-400">{fd.bits}</span>}
      {fd.changes
        .filter((c) => c.prop !== "desc")
        .map((c, i) => (
          <ChangeLine key={i} prop={c.prop} from={c.from} to={c.to} />
        ))}
    </span>
  );
}

export function RegHistory({ project, modulePath, reg }: { project: string; modulePath: string; reg: string }) {
  const router = useRouter();
  const { data, error, loading } = useApi<RegHistoryData>(
    `/api/projects/${project}/sfr/reg-history?path=${encodeURIComponent(modulePath)}&reg=${encodeURIComponent(reg)}`
  );

  if (loading && !data) return <div className="border-t border-neutral-200 bg-neutral-50/40"><Spinner label="Tracing register across tags…" /></div>;
  if (error) return <div className="border-t border-neutral-200 bg-red-50 px-4 py-3 font-mono text-xs text-red-700">{error}</div>;
  if (!data) return null;

  // show change points (plus the introduction); collapse runs of "unchanged"
  const points = data.entries.filter((e) => e.status === "initial" || e.status === "added" || e.status === "modified" || e.status === "removed");

  const openDiff = (e: RegHistoryEntry) => {
    const idx = data.entries.findIndex((x) => x.ref === e.ref);
    if (idx <= 0) return;
    const from = data.entries[idx - 1].ref;
    router.push(`/${project}/sfr/changelog?from=${encodeURIComponent(from)}&to=${encodeURIComponent(e.ref)}`);
  };

  return (
    <div className="border-t border-neutral-200 bg-neutral-50/40 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-[10px] tracking-wider text-neutral-400 uppercase">
        history
        <span className="text-neutral-400 normal-case">
          {data.changeCount === 0 ? "unchanged since baseline" : `${data.changeCount} change point${data.changeCount > 1 ? "s" : ""} across ${data.entries.length} tags`}
        </span>
      </div>
      <div className="relative flex flex-col">
        {points.map((e, i) => (
          <button
            key={e.ref}
            onClick={() => e.status !== "initial" && openDiff(e)}
            className={cx(
              "group relative flex items-start gap-3 rounded-md py-1.5 pr-2 pl-1 text-left",
              e.status !== "initial" && "cursor-pointer hover:bg-white"
            )}
          >
            <span className="absolute top-0 bottom-0 left-[18px] w-px bg-neutral-200" style={i === 0 ? { top: "12px" } : i === points.length - 1 ? { bottom: "auto", height: "12px" } : undefined} />
            <span
              className={cx(
                "relative z-10 mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border bg-white",
                e.status === "removed" ? "border-red-400" : e.status === "modified" ? "border-amber-400" : "border-emerald-400"
              )}
            >
              <span className={cx("h-1.5 w-1.5 rounded-full", e.status === "removed" ? "bg-red-500" : e.status === "modified" ? "bg-amber-500" : "bg-emerald-500")} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <IconTag size={11} className="text-neutral-400" />
                <span className="font-mono text-[12px] font-semibold">{e.ref}</span>
                <Badge kind={e.status === "removed" ? "removed" : e.status === "modified" ? "modified" : "added"}>{STATUS_LABEL[e.status]}</Badge>
                <span className="font-mono text-[10px] text-neutral-400">{fmtDate(e.date)}</span>
              </span>
              {/* register-level changes */}
              {e.changes.filter((c) => c.prop !== "desc").length > 0 && (
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 pl-3">
                  {e.changes
                    .filter((c) => c.prop !== "desc")
                    .map((c, j) => (
                      <ChangeLine key={j} prop={c.prop} from={c.from} to={c.to} />
                    ))}
                </span>
              )}
              {/* field-level changes */}
              {e.fields.length > 0 && (
                <span className="mt-1 flex flex-col gap-1">
                  {e.fields.map((fd) => (
                    <FieldChange key={`${fd.name}-${fd.status}`} fd={fd} />
                  ))}
                </span>
              )}
              {/* added/removed snapshot */}
              {(e.status === "initial" || e.status === "added" || e.status === "removed") && e.snapshot && (
                <span className="mt-0.5 block pl-3 font-mono text-[10px] text-neutral-400">
                  {e.snapshot.fields.length} fields:{" "}
                  {e.snapshot.fields
                    .slice()
                    .sort((a, b) => b.msb - a.msb)
                    .map((f) => `${f.name}${bitsLabel(f.msb, f.lsb)}`)
                    .join(" · ")}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
