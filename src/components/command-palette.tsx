"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchHit } from "@/lib/types";
import { IconSearch } from "./icons";
import { Badge, cx } from "./ui";

const typeBadge: Record<string, { label: string; kind: string }> = {
  register: { label: "REG", kind: "dark" },
  field: { label: "FLD", kind: "neutral" },
  function: { label: "FN", kind: "dark" },
  class: { label: "CLS", kind: "neutral" },
  module: { label: "MOD", kind: "outline" },
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!q.trim()) return;
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((body) => {
          setHits(body.hits ?? []);
          setSel(0);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, 120);
    return () => clearTimeout(timer);
  }, [q]);

  const visible = q.trim() ? hits : [];

  const grouped = useMemo(() => {
    const byProject = new Map<string, SearchHit[]>();
    for (const h of visible) {
      if (!byProject.has(h.projectName)) byProject.set(h.projectName, []);
      byProject.get(h.projectName)!.push(h);
    }
    return [...byProject.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.length, hits]);

  const go = (hit: SearchHit) => {
    onClose();
    router.push(hit.href);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-100 flex items-start justify-center bg-neutral-900/30 pt-[14vh] backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="pop-in w-[620px] max-w-[calc(100vw-40px)] overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-neutral-200 px-4">
          <IconSearch size={15} className="text-neutral-400" />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, visible.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter" && visible[sel]) {
                go(visible[sel]);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder="Search registers, fields, HAL functions…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
          />
          {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-neutral-200 border-t-neutral-700" />}
          <kbd className="rounded border border-neutral-200 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">esc</kbd>
        </div>

        <div className="max-h-[46vh] overflow-y-auto p-1.5">
          {!q.trim() && (
            <div className="px-3 py-8 text-center text-xs text-neutral-400">
              Type to search across all projects — e.g. <span className="font-mono">CTRL</span>,{" "}
              <span className="font-mono">BURST</span>, <span className="font-mono">SetKey</span>
            </div>
          )}
          {q.trim() && !loading && !visible.length && (
            <div className="px-3 py-8 text-center text-xs text-neutral-400">No results for “{q}”</div>
          )}
          {grouped.map(([projectName, items]) => (
            <div key={projectName}>
              <div className="px-3 pt-2 pb-1 text-[10px] font-medium tracking-[0.12em] text-neutral-400 uppercase">
                {projectName}
              </div>
              {items.map((hit) => {
                const idx = visible.indexOf(hit);
                const tb = typeBadge[hit.type] ?? typeBadge.module;
                return (
                  <button
                    key={`${hit.href}-${hit.label}`}
                    onClick={() => go(hit)}
                    onMouseEnter={() => setSel(idx)}
                    className={cx(
                      "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors",
                      idx === sel ? "bg-neutral-900 text-white" : "text-neutral-700"
                    )}
                  >
                    <Badge kind={idx === sel ? "outline" : tb.kind} className="w-10 justify-center">
                      {tb.label}
                    </Badge>
                    <span className="font-mono text-[12.5px] font-medium">{hit.label}</span>
                    <span className={cx("ml-auto truncate pl-3 text-[11px]", idx === sel ? "text-neutral-400" : "text-neutral-400")}>
                      {hit.context}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-neutral-200 bg-neutral-50 px-4 py-2 text-[10px] text-neutral-400">
          <span>
            <kbd className="font-mono">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> open
          </span>
          <span className="ml-auto">searches the latest tag of every project</span>
        </div>
      </div>
    </div>
  );
}
