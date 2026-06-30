"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { accessStyle, specialAccessTokens } from "@/lib/access";
import { abbreviate } from "@/lib/abbrev";
import { channelLabel } from "@/lib/channels";
import { bitsLabel, hex } from "@/lib/format";
import type { SfrField, SfrReg } from "@/lib/types";
import { cx } from "./ui";

const CELL_W = 21; // nominal px per bit column (used for abbreviation budget)
const MIN_CELL_W = 18; // minimum px per bit column before horizontal scroll kicks in
const NAME_W = 168;

type Cell =
  | { kind: "field"; field: SfrField; span: number }
  | { kind: "rsvd"; span: number; msb: number; lsb: number };

function buildCells(reg: SfrReg): Cell[] {
  const cells: Cell[] = [];
  const fields = [...reg.fields].sort((a, b) => b.msb - a.msb);
  let bit = reg.width - 1;
  for (const f of fields) {
    // Guard against malformed registers: a field that overlaps already-placed
    // bits (or sits entirely outside the register) would otherwise make the
    // emitted spans exceed reg.width and warp the whole table. Skip it, and
    // clamp a partially-overlapping field's top to the remaining width.
    if (f.lsb > bit || f.lsb < 0) continue;
    const msb = Math.min(f.msb, bit);
    if (msb < bit) {
      cells.push({ kind: "rsvd", span: bit - msb, msb: bit, lsb: msb + 1 });
    }
    cells.push({ kind: "field", field: f, span: msb - f.lsb + 1 });
    bit = f.lsb - 1;
  }
  if (bit >= 0) cells.push({ kind: "rsvd", span: bit + 1, msb: bit, lsb: 0 });
  return cells;
}

// ---------------- delegated field tooltip ----------------
//
// A register map with hundreds of registers renders thousands of field cells.
// Giving every cell its own stateful tooltip component is the dominant mount
// cost, so instead each field cell is a plain button carrying `data-*` and a
// single <FieldTipScope> delegates hover for the whole table to one overlay.

interface TipHandle {
  show: (ds: DOMStringMap, x: number, y: number) => void;
  hide: () => void;
}

const FieldTipOverlay = forwardRef<TipHandle>(function FieldTipOverlay(_props, ref) {
  const [s, setS] = useState<
    { reg: string; name: string; sw: string; hw: string; reset: number; msb: number; lsb: number; desc: string; x: number; y: number } | null
  >(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({ w: 288, h: 96 });

  useImperativeHandle(
    ref,
    () => ({
      show: (ds, x, y) =>
        setS({
          reg: ds.reg ?? "",
          name: ds.name ?? "",
          sw: ds.sw ?? "",
          hw: ds.hw ?? "",
          reset: Number(ds.reset ?? 0),
          msb: Number(ds.msb ?? 0),
          lsb: Number(ds.lsb ?? 0),
          desc: ds.desc ?? "",
          x,
          y,
        }),
      hide: () => setS(null),
    }),
    []
  );

  // measure after render so the box stays correctly sized as content changes;
  // the >1px guard makes it converge (no dependency array on purpose)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.width - size.w) > 1 || Math.abs(r.height - size.h) > 1) setSize({ w: r.width, h: r.height });
  });

  if (!s || typeof document === "undefined") return null;
  const { w, h } = size;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const M = 8;
  let left = s.x + 14;
  if (left + w > vw - M) left = s.x - 14 - w;
  left = Math.max(M, Math.min(left, vw - w - M));
  let top = s.y + 16;
  if (top + h > vh - M) top = s.y - 12 - h;
  top = Math.max(M, Math.min(top, vh - h - M));
  const a = accessStyle(s.sw);

  return createPortal(
    <span
      ref={tipRef}
      className="pop-in pointer-events-none fixed z-[200] max-w-72 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[11px] leading-relaxed text-neutral-100 shadow-xl"
      style={{ left, top }}
    >
      <span className="block min-w-44">
        <span className="flex items-center gap-1.5 font-mono text-xs font-semibold text-neutral-100">
          {s.reg}.{s.name}
          <span className="rounded px-1 text-[9px] font-bold text-white uppercase" style={{ background: a.accent || "#525252" }}>
            {s.sw}
          </span>
        </span>
        <span className="mt-1 block font-mono text-[10.5px] text-neutral-300">
          bits {bitsLabel(s.msb, s.lsb)} · sw {s.sw} · hw {s.hw} · reset {hex(s.reset)}
        </span>
        {s.desc && <span className="mt-1 block text-neutral-400">{s.desc}</span>}
      </span>
    </span>,
    document.body
  );
});

/** Wraps a register map and shows one shared tooltip for any `[data-fld]` cell inside. */
export const FieldTipScope = forwardRef<HTMLDivElement, { children: ReactNode; className?: string; style?: CSSProperties }>(
  function FieldTipScope({ children, className, style }, ref) {
    const tip = useRef<TipHandle>(null);
    return (
      <div
        ref={ref}
        className={className}
        style={style}
        onMouseMove={(e) => {
          const b = (e.target as HTMLElement).closest?.("[data-fld]") as HTMLElement | null;
          if (b) tip.current?.show(b.dataset, e.clientX, e.clientY);
          else tip.current?.hide();
        }}
        onMouseLeave={() => tip.current?.hide()}
      >
        {children}
        <FieldTipOverlay ref={tip} />
      </div>
    );
  }
);

/** legend of the special access tokens present (omitted when everything is plain rw) */
export function AccessLegend({ regs, className }: { regs: SfrReg[]; className?: string }) {
  const tokens = specialAccessTokens(regs.flatMap((r) => r.fields.map((f) => f.sw)));
  if (!tokens.length) return null;
  return (
    <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-neutral-400", className)}>
      <span className="tracking-wider uppercase">access</span>
      {tokens.map((t) => (
        <span key={t.token} className="inline-flex items-center gap-1" title={t.title}>
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: t.accent }} />
          <span className="font-mono text-neutral-500">{t.token}</span>
          <span className="text-neutral-400">{t.title}</span>
        </span>
      ))}
    </div>
  );
}

export function BitHeaderRow({ width = 32, label }: { width?: number; label?: string }) {
  return (
    <tr>
      <th className="sticky left-0 z-10 border-b border-neutral-200 bg-neutral-50 px-3 py-1 text-left align-bottom font-mono text-[9.5px] font-medium text-neutral-400">
        {label ?? ""}
      </th>
      {Array.from({ length: width }, (_, i) => {
        const bit = width - 1 - i;
        return (
          <th
            key={bit}
            className={cx(
              "border-b border-neutral-200 bg-neutral-50 py-1 text-center font-mono text-[8.5px] font-normal text-neutral-400",
              bit % 8 === 0 && bit !== 0 && "border-l border-l-neutral-200"
            )}
          >
            {bit}
          </th>
        );
      })}
    </tr>
  );
}

export function RegBitRow({
  reg,
  onFieldClick,
  highlightField,
  nameCell,
  rowId,
  flash,
}: {
  reg: SfrReg;
  onFieldClick?: (reg: SfrReg, field: SfrField) => void;
  highlightField?: string | null;
  nameCell?: React.ReactNode;
  rowId?: string;
  flash?: boolean;
}) {
  const cells = buildCells(reg);
  return (
    <tr id={rowId} className={cx("group/row", flash && "flash-ring")}>
      <td className="sticky left-0 z-10 h-14 border-b border-neutral-100 bg-white px-3 align-middle transition-colors group-hover/row:bg-neutral-50">
        {nameCell ?? (
          <span className="block">
            <span className="block truncate font-mono text-[11.5px] font-semibold text-neutral-900" title={reg.name}>
              {channelLabel(reg)}
            </span>
            <span className="block font-mono text-[9.5px] text-neutral-400">{hex(reg.offset, 4)}</span>
          </span>
        )}
      </td>
      {cells.map((cell, i) => {
        if (cell.kind === "rsvd") {
          return (
            <td
              key={i}
              colSpan={cell.span}
              className="hatch h-14 border-b border-l border-neutral-100 bg-neutral-50/40"
              title={`reserved ${bitsLabel(cell.msb, cell.lsb)}`}
            />
          );
        }
        const f = cell.field;
        const vertical = cell.span <= 2;
        const maxChars = vertical ? 8 : Math.max(3, Math.floor((cell.span * CELL_W - 10) / 6.3));
        const text = abbreviate(f.name, maxChars);
        const highlighted = highlightField === f.name;
        const a = accessStyle(f.sw);
        return (
          <td key={i} colSpan={cell.span} className="h-14 border-b border-l border-neutral-200 p-0">
            <button
              data-fld=""
              data-reg={reg.name}
              data-name={f.name}
              data-sw={f.sw}
              data-hw={f.hw}
              data-reset={f.reset ?? 0}
              data-msb={f.msb}
              data-lsb={f.lsb}
              data-desc={f.desc ?? ""}
              onClick={onFieldClick ? () => onFieldClick(reg, f) : undefined}
              style={a.accent ? { boxShadow: `inset 0 -3px 0 0 ${a.accent}` } : undefined}
              className={cx(
                "flex h-14 w-full items-center justify-center overflow-hidden font-mono text-[10px] leading-none transition-all duration-100",
                onFieldClick && "cursor-pointer",
                highlighted
                  ? "bg-neutral-900 font-semibold text-white"
                  : "bg-white text-neutral-800 hover:bg-neutral-900 hover:text-white"
              )}
            >
              <span className={cx(vertical && "vtext", "max-h-13 px-0.5")}>{text}</span>
            </button>
          </td>
        );
      })}
    </tr>
  );
}

// ---------------- virtualization ----------------
//
// At a glance an IP can have hundreds of registers. Rendering every row is the
// dominant React mount cost (layout/parse are already cheap), so the table is
// its own scroll area and only the rows in (and near) the viewport are mounted.

const REG_H = 56; // h-14 register row
const HEADER_H = 26; // bit-number header row
const TITLE_H = 34; // group title row

/** Largest index i with offsets[i] <= y (binary search over the cumulative offsets). */
function lastIndexAtOrBelow(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function useVirtualRows(scrollRef: RefObject<HTMLDivElement | null>, heights: number[]) {
  const offsets = useMemo(() => {
    const o = [0];
    for (const h of heights) o.push(o[o.length - 1] + h);
    return o;
  }, [heights]);
  const total = offsets[offsets.length - 1];
  const [win, setWin] = useState({ start: 0, end: Math.min(heights.length, 40) });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      const top = el.scrollTop;
      const h = el.clientHeight || 600;
      const pad = h; // ~one viewport of overscan on each side keeps scrolling smooth
      const start = lastIndexAtOrBelow(offsets, top - pad);
      const end = Math.min(heights.length, lastIndexAtOrBelow(offsets, top + h + pad) + 1);
      setWin((p) => (p.start === start && p.end === end ? p : { start, end }));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    compute();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => compute());
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [offsets, heights.length, scrollRef]);

  const start = Math.min(win.start, heights.length);
  const end = Math.min(win.end, heights.length);
  return { start, end, padTop: offsets[start] || 0, padBottom: Math.max(0, total - (offsets[end] ?? total)) };
}

type Group = { id: string; title?: string; sub?: string; regs: SfrReg[] };
type VRow =
  | { key: string; type: "title"; g: Group; gi: number }
  | { key: string; type: "header"; g: Group; gi: number }
  | { key: string; type: "reg"; g: Group; gi: number; reg: SfrReg };

/** Full register map table for a list of registers (optionally grouped). */
export function RegmapTable({
  groups,
  width = 32,
  onFieldClick,
  onGroupClick,
  highlight,
}: {
  groups: Group[];
  width?: number;
  onFieldClick?: (groupId: string, reg: SfrReg, field: SfrField) => void;
  onGroupClick?: (groupId: string) => void;
  highlight?: { groupId?: string; reg?: string | null; field?: string | null };
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState<number>();

  // cap the table to the remaining viewport so it scrolls internally
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const calc = () => setMaxH(Math.max(240, window.innerHeight - el.getBoundingClientRect().top - 16));
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  const vrows = useMemo<VRow[]>(() => {
    const out: VRow[] = [];
    groups.forEach((g, gi) => {
      if (g.title) out.push({ key: `t-${g.id}`, type: "title", g, gi });
      out.push({ key: `h-${g.id}`, type: "header", g, gi });
      for (const reg of g.regs) out.push({ key: `r-${g.id}-${reg.name}`, type: "reg", g, gi, reg });
    });
    return out;
  }, [groups]);
  const heights = useMemo(() => vrows.map((v) => (v.type === "reg" ? REG_H : v.type === "title" ? TITLE_H : HEADER_H)), [vrows]);
  const { start, end, padTop, padBottom } = useVirtualRows(scrollRef, heights);

  return (
    <FieldTipScope ref={scrollRef} className="overflow-auto rounded-lg border border-neutral-200 bg-white" style={{ maxHeight: maxH ?? "70vh" }}>
      <table className="w-full border-separate border-spacing-0" style={{ minWidth: NAME_W + width * MIN_CELL_W, tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: NAME_W }} />
          {Array.from({ length: width }, (_, i) => (
            <col key={i} />
          ))}
        </colgroup>
        <tbody>
          {padTop > 0 && (
            <tr>
              <td colSpan={width + 1} style={{ height: padTop, padding: 0, border: 0 }} />
            </tr>
          )}
          {vrows.slice(start, end).map((v) => {
            if (v.type === "title") {
              return (
                <tr key={v.key}>
                  <td
                    colSpan={width + 1}
                    className={cx("sticky left-0 border-b border-neutral-200 bg-neutral-50 px-3 py-1.5", v.gi > 0 && "border-t")}
                  >
                    <button
                      onClick={() => onGroupClick?.(v.g.id)}
                      className={cx(
                        "flex items-baseline gap-2 text-left",
                        onGroupClick && "cursor-pointer transition-colors hover:text-neutral-900"
                      )}
                    >
                      <span className="font-mono text-[11px] font-semibold text-neutral-700 underline-offset-2 hover:underline">
                        {v.g.title}
                      </span>
                      {v.g.sub && <span className="text-[10px] text-neutral-400">{v.g.sub}</span>}
                      <span className="text-[10px] text-neutral-400">· {v.g.regs.length} regs</span>
                    </button>
                  </td>
                </tr>
              );
            }
            if (v.type === "header") return <BitHeaderRow key={v.key} width={width} label="register" />;
            return (
              <RegBitRow
                key={v.key}
                reg={v.reg}
                rowId={`reg-${v.g.id}-${v.reg.name}`}
                flash={highlight?.groupId === v.g.id && highlight?.reg === v.reg.name}
                highlightField={highlight?.groupId === v.g.id && highlight?.reg === v.reg.name ? highlight?.field : null}
                onFieldClick={onFieldClick ? (r, f) => onFieldClick(v.g.id, r, f) : undefined}
              />
            );
          })}
          {padBottom > 0 && (
            <tr>
              <td colSpan={width + 1} style={{ height: padBottom, padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </FieldTipScope>
  );
}
