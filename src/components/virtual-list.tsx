"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useRef } from "react";
import { cx } from "./ui";

export interface VRow {
  key: string;
  /** estimated px height (corrected by live measurement) */
  estimate: number;
  node: ReactNode;
}

/**
 * Windowed list: only the rows intersecting the viewport (plus overscan) are
 * mounted, so a diff with thousands of entries keeps a small, bounded DOM.
 * Heights are measured live, so variable-height rows lay out correctly.
 */
export function VirtualList({ rows, className }: { rows: VRow[]; className?: string }) {
  "use no memo"; // useVirtualizer relies on live scroll state; opt out of React Compiler memoization
  const parentRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- handled via the "use no memo" directive above
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => rows[i].estimate,
    getItemKey: (i) => rows[i].key,
    overscan: 10,
  });

  return (
    <div ref={parentRef} className={cx("min-h-0 flex-1 overflow-y-auto", className)}>
      <div style={{ height: virt.getTotalSize(), position: "relative", width: "100%" }}>
        {virt.getVirtualItems().map((vi) => (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={virt.measureElement}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
          >
            {rows[vi.index].node}
          </div>
        ))}
      </div>
    </div>
  );
}
