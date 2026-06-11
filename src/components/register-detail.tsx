"use client";

import { useEffect, useRef } from "react";
import { accessStyle } from "@/lib/access";
import { bitsLabel, hex } from "@/lib/format";
import type { SfrModule, SfrReg } from "@/lib/types";
import { AccessLegend, BitHeaderRow, RegBitRow } from "./regmap";
import { Badge, Card, cx } from "./ui";

function regReset(reg: SfrReg): string {
  let v = 0;
  for (const f of reg.fields) v += (f.reset ?? 0) * 2 ** f.lsb;
  return "0x" + v.toString(16).toUpperCase().padStart(Math.ceil(reg.width / 4), "0");
}

export function RegisterCard({
  reg,
  highlightField,
  flash,
}: {
  reg: SfrReg;
  highlightField?: string | null;
  flash?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (flash && ref.current) {
      ref.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [flash]);

  const fields = [...reg.fields].sort((a, b) => b.msb - a.msb);

  return (
    <Card className={cx("fade-up overflow-hidden", flash && "flash-ring")} >
      <div ref={ref} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-neutral-200 bg-neutral-50/60 px-4 py-2.5">
        <span className="font-mono text-[14px] font-bold tracking-tight text-neutral-900">{reg.name}</span>
        {reg.dispName && reg.dispName !== reg.name && (
          <span className="text-xs text-neutral-500">{reg.dispName}</span>
        )}
        <span className="ml-auto flex items-center gap-2 font-mono text-[10.5px] text-neutral-400">
          <Badge kind="outline">offset {hex(reg.offset, 4)}</Badge>
          <Badge kind="outline">{reg.width}-bit</Badge>
          <Badge kind="outline">reset {regReset(reg)}</Badge>
        </span>
      </div>

      {reg.desc && <p className="px-4 pt-2.5 text-xs leading-relaxed text-neutral-500">{reg.desc}</p>}

      {/* bit strip */}
      <div className="overflow-x-auto px-4 pt-3">
        <table className="w-full border-separate border-spacing-0" style={{ minWidth: 168 + reg.width * 18, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 168 }} />
            {Array.from({ length: reg.width }, (_, i) => (
              <col key={i} />
            ))}
          </colgroup>
          <tbody>
            <BitHeaderRow width={reg.width} />
            <RegBitRow reg={reg} highlightField={highlightField} />
          </tbody>
        </table>
        <AccessLegend regs={[reg]} className="mt-2.5 mb-0.5" />
      </div>

      {/* field table */}
      <table className="mt-3 w-full border-t border-neutral-200 text-xs">
        <thead>
          <tr className="text-left text-[10px] tracking-[0.1em] text-neutral-400 uppercase">
            <th className="px-4 py-1.5 font-medium">Bits</th>
            <th className="py-1.5 font-medium">Field</th>
            <th className="py-1.5 font-medium">SW</th>
            <th className="py-1.5 font-medium">HW</th>
            <th className="py-1.5 font-medium">Reset</th>
            <th className="py-1.5 pr-4 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr
              key={f.name}
              className={cx(
                "border-t border-neutral-100 transition-colors",
                highlightField === f.name ? "bg-neutral-900 text-white" : "hover:bg-neutral-50"
              )}
            >
              <td className="px-4 py-1.5 font-mono text-[11px] whitespace-nowrap">{bitsLabel(f.msb, f.lsb)}</td>
              <td className="py-1.5 pr-3 font-mono text-[11.5px] font-semibold">{f.name}</td>
              <td className="py-1.5 pr-3 font-mono text-[10.5px] whitespace-nowrap">
                <span
                  className={cx(
                    "inline-flex items-center gap-1 rounded border px-1 py-px",
                    highlightField === f.name ? "border-white/25 bg-white/10 text-neutral-100" : accessStyle(f.sw).badge
                  )}
                  title={accessStyle(f.sw).title}
                >
                  {f.sw}
                </span>
              </td>
              <td className={cx("py-1.5 pr-3 font-mono text-[10.5px]", highlightField === f.name ? "text-neutral-300" : "text-neutral-500")}>
                {f.hw}
              </td>
              <td className="py-1.5 pr-3 font-mono text-[10.5px] whitespace-nowrap">{hex(f.reset ?? 0)}</td>
              <td className={cx("max-w-md py-1.5 pr-4 leading-relaxed", highlightField === f.name ? "text-neutral-300" : "text-neutral-500")}>
                {f.desc}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function ModuleDetail({
  mod,
  highlightReg,
  highlightField,
}: {
  mod: SfrModule;
  highlightReg?: string | null;
  highlightField?: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {mod.regs.map((reg) => (
        <RegisterCard
          key={reg.name}
          reg={reg}
          flash={highlightReg === reg.name}
          highlightField={highlightReg === reg.name ? highlightField : null}
        />
      ))}
    </div>
  );
}
