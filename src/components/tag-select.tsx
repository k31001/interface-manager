"use client";

import { fmtDate } from "@/lib/format";
import type { TagInfo } from "@/lib/types";
import { IconTag } from "./icons";
import { Select } from "./ui";

export function TagSelect({
  tags,
  value,
  onChange,
  className,
  allowLatest = true,
}: {
  tags: TagInfo[];
  value?: string | null;
  onChange: (tag: string | null) => void;
  className?: string;
  allowLatest?: boolean;
}) {
  const latest = tags[tags.length - 1]?.name;
  const newestFirst = [...tags].reverse();
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
      <IconTag size={13} className="text-neutral-400" />
      <Select
        value={value ?? (allowLatest ? "" : (latest ?? ""))}
        onChange={(e) => onChange(e.target.value || null)}
      >
        {allowLatest && <option value="">latest ({latest ?? "—"})</option>}
        {newestFirst.map((t) => (
          <option key={t.name} value={t.name}>
            {t.name} · {fmtDate(t.date)}
          </option>
        ))}
      </Select>
    </span>
  );
}
