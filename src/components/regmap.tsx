"use client";

import { accessStyle, specialAccessTokens } from "@/lib/access";
import { abbreviate } from "@/lib/abbrev";
import { channelLabel } from "@/lib/channels";
import { bitsLabel, hex } from "@/lib/format";
import type { SfrField, SfrReg } from "@/lib/types";
import { HoverTip, cx } from "./ui";

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

function FieldTip({ reg, field }: { reg: SfrReg; field: SfrField }) {
  const a = accessStyle(field.sw);
  return (
    <span className="block min-w-44">
      <span className="flex items-center gap-1.5 font-mono text-xs font-semibold">
        {reg.name}.{field.name}
        <span className="rounded px-1 text-[9px] font-bold uppercase" style={{ background: a.accent || "#525252", color: "#fff" }}>
          {field.sw}
        </span>
      </span>
      <span className="mt-1 block font-mono text-[10.5px] text-neutral-300">
        bits {bitsLabel(field.msb, field.lsb)} · sw {field.sw} · hw {field.hw} · reset {hex(field.reset ?? 0)}
      </span>
      {field.desc && <span className="mt-1 block text-neutral-400">{field.desc}</span>}
    </span>
  );
}

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
            <HoverTip tip={<FieldTip reg={reg} field={f} />} className="block h-full w-full">
              <button
                onClick={() => onFieldClick?.(reg, f)}
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
            </HoverTip>
          </td>
        );
      })}
    </tr>
  );
}

/** Full register map table for a list of registers (optionally grouped). */
export function RegmapTable({
  groups,
  width = 32,
  onFieldClick,
  onGroupClick,
  highlight,
}: {
  groups: { id: string; title?: string; sub?: string; regs: SfrReg[] }[];
  width?: number;
  onFieldClick?: (groupId: string, reg: SfrReg, field: SfrField) => void;
  onGroupClick?: (groupId: string) => void;
  highlight?: { groupId?: string; reg?: string | null; field?: string | null };
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table
        className="w-full border-separate border-spacing-0"
        style={{ minWidth: NAME_W + width * MIN_CELL_W, tableLayout: "fixed" }}
      >
        <colgroup>
          <col style={{ width: NAME_W }} />
          {Array.from({ length: width }, (_, i) => (
            <col key={i} />
          ))}
        </colgroup>
        <tbody>
          {groups.map((g, gi) => (
            <Group
              key={g.id}
              g={g}
              gi={gi}
              width={width}
              onFieldClick={onFieldClick}
              onGroupClick={onGroupClick}
              highlight={highlight}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Group({
  g,
  gi,
  width,
  onFieldClick,
  onGroupClick,
  highlight,
}: {
  g: { id: string; title?: string; sub?: string; regs: SfrReg[] };
  gi: number;
  width: number;
  onFieldClick?: (groupId: string, reg: SfrReg, field: SfrField) => void;
  onGroupClick?: (groupId: string) => void;
  highlight?: { groupId?: string; reg?: string | null; field?: string | null };
}) {
  return (
    <>
      {g.title && (
        <tr>
          <td
            colSpan={width + 1}
            className={cx("sticky left-0 border-b border-neutral-200 bg-neutral-50 px-3 py-1.5", gi > 0 && "border-t")}
          >
            <button
              onClick={() => onGroupClick?.(g.id)}
              className={cx(
                "flex items-baseline gap-2 text-left",
                onGroupClick && "cursor-pointer transition-colors hover:text-neutral-900"
              )}
            >
              <span className="font-mono text-[11px] font-semibold text-neutral-700 underline-offset-2 hover:underline">
                {g.title}
              </span>
              {g.sub && <span className="text-[10px] text-neutral-400">{g.sub}</span>}
              <span className="text-[10px] text-neutral-400">· {g.regs.length} regs</span>
            </button>
          </td>
        </tr>
      )}
      <BitHeaderRow width={width} label="register" />
      {g.regs.map((reg) => (
        <RegBitRow
          key={reg.name}
          reg={reg}
          rowId={`reg-${g.id}-${reg.name}`}
          flash={highlight?.groupId === g.id && highlight?.reg === reg.name}
          highlightField={highlight?.groupId === g.id && highlight?.reg === reg.name ? highlight?.field : null}
          onFieldClick={onFieldClick ? (r, f) => onFieldClick(g.id, r, f) : undefined}
        />
      ))}
    </>
  );
}
