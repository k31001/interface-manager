"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { accessStyle } from "@/lib/access";
import { bitsLabel, hex } from "@/lib/format";
import type { FnRef } from "@/lib/trace";
import type { SfrField, SfrModule, SfrReg } from "@/lib/types";
import { IconCode, IconFn, IconPulse } from "./icons";
import { AccessLegend, BitHeaderRow, RegBitRow } from "./regmap";
import { Badge, Btn, Card, cx } from "./ui";
import { RegHistory } from "./reg-history";

const fnAccessColor: Record<string, string> = {
  w: "text-amber-700 bg-amber-50 border-amber-200",
  r: "text-sky-700 bg-sky-50 border-sky-200",
  rw: "text-violet-700 bg-violet-50 border-violet-200",
};

/** HAL functions that touch this register, derived from the .c implementation */
function UsedBy({ project, used }: { project: string; used: FnRef[] }) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-100 px-4 py-2">
      <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-wider text-neutral-400 uppercase">
        <IconFn size={12} /> used by
      </span>
      {used.map((u) => (
        <button
          key={u.fn}
          onClick={() => router.push(`/${project}/hal?fn=${encodeURIComponent(u.fn)}`)}
          title="open in HAL docs"
          className={cx(
            "inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-px font-mono text-[10.5px] transition-colors hover:brightness-95",
            fnAccessColor[u.access] ?? fnAccessColor.r
          )}
        >
          {u.fn}
          <span className="opacity-60">{u.access}</span>
        </button>
      ))}
      <span className="ml-auto font-mono text-[9.5px] text-neutral-300">from HAL impl</span>
    </div>
  );
}

function resetValue(reg: SfrReg): number {
  let v = 0;
  for (const f of reg.fields) v += (f.reset ?? 0) * 2 ** f.lsb;
  return v;
}

function regReset(reg: SfrReg): string {
  const digits = Math.max(1, Math.ceil(reg.width / 4));
  return "0x" + resetValue(reg).toString(16).toUpperCase().padStart(digits, "0");
}

function parseNum(s: string): number {
  const t = s.trim().replace(/_/g, "");
  if (!t) return NaN;
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t.slice(2), 16);
  if (/^0b[01]+$/i.test(t)) return parseInt(t.slice(2), 2);
  if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
  return NaN;
}

const fieldVal = (regValue: number, f: SfrField) => Math.floor(regValue / 2 ** f.lsb) % 2 ** f.width;

/** Bidirectional value decoder: type a register value to see fields, or edit fields to build the value. */
function RegisterDecoder({ reg }: { reg: SfrReg }) {
  const reset = useMemo(() => resetValue(reg), [reg]);
  const mask = (v: number) => ((Math.round(v) % 2 ** reg.width) + 2 ** reg.width) % 2 ** reg.width;
  const [value, setValue] = useState(reset);
  const [text, setText] = useState("0x" + reset.toString(16).toUpperCase());
  const digits = Math.max(1, Math.ceil(reg.width / 4));

  const apply = (v: number) => {
    const m = mask(v);
    setValue(m);
    setText("0x" + m.toString(16).toUpperCase().padStart(digits, "0"));
  };
  const setField = (f: SfrField, raw: string) => {
    const fv = parseNum(raw);
    if (Number.isNaN(fv)) return;
    const clamped = Math.min(fv, 2 ** f.width - 1);
    apply(value - fieldVal(value, f) * 2 ** f.lsb + clamped * 2 ** f.lsb);
  };

  const fields = [...reg.fields].sort((a, b) => b.msb - a.msb);
  // binary string MSB→LSB grouped in nibbles
  const bin = Array.from({ length: reg.width }, (_, i) => (Math.floor(value / 2 ** (reg.width - 1 - i)) % 2 ? "1" : "0"));
  const binGroups: string[] = [];
  for (let i = 0; i < bin.length; i += 4) binGroups.push(bin.slice(i, i + 4).join(""));

  return (
    <div className="border-t border-neutral-200 bg-neutral-50/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-medium tracking-wider text-neutral-400 uppercase">value</span>
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const v = parseNum(e.target.value);
            if (!Number.isNaN(v)) setValue(mask(v));
          }}
          spellCheck={false}
          className="h-7 w-36 rounded-md border border-neutral-300 bg-white px-2 font-mono text-xs outline-none focus:border-neutral-900"
        />
        <span className="font-mono text-[11px] tracking-tight text-neutral-400">{binGroups.join(" ")}</span>
        <span className="ml-auto flex gap-1.5">
          <Btn onClick={() => apply(reset)}>reset</Btn>
          <Btn onClick={() => apply(0)}>clear</Btn>
        </span>
      </div>
      <table className="mt-2.5 w-full text-xs">
        <tbody>
          {fields.map((f) => {
            const v = fieldVal(value, f);
            const a = accessStyle(f.sw);
            return (
              <tr key={f.name} className="border-t border-neutral-200/70 first:border-0">
                <td className="py-1 pr-3 font-mono text-[10.5px] whitespace-nowrap text-neutral-400">{bitsLabel(f.msb, f.lsb)}</td>
                <td className="py-1 pr-3 font-mono text-[11px] font-semibold">{f.name}</td>
                <td className="py-1 pr-2">
                  <input
                    value={"0x" + v.toString(16).toUpperCase()}
                    onChange={(e) => setField(f, e.target.value)}
                    spellCheck={false}
                    className="h-6 w-20 rounded border border-neutral-200 bg-white px-1.5 font-mono text-[11px] outline-none focus:border-neutral-900"
                    style={a.accent ? { borderLeftColor: a.accent, borderLeftWidth: 2 } : undefined}
                  />
                </td>
                <td className="py-1 pr-3 font-mono text-[10.5px] text-neutral-400">= {v}</td>
                <td className="py-1 font-mono text-[10px] text-neutral-300">
                  {f.width}-bit{f.width <= 8 ? ` · 0b${v.toString(2).padStart(f.width, "0")}` : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RegisterCard({
  reg,
  highlightField,
  flash,
  project,
  modulePath,
  regUsedBy,
}: {
  reg: SfrReg;
  highlightField?: string | null;
  flash?: boolean;
  project?: string;
  modulePath?: string;
  regUsedBy?: Record<string, FnRef[]>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<"decode" | "history" | null>(null);
  const ip = modulePath?.split("/").at(-2);
  const used = ip ? regUsedBy?.[`${ip}::${reg.name}`] : undefined;
  useEffect(() => {
    if (flash && ref.current) {
      ref.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [flash]);

  const fields = [...reg.fields].sort((a, b) => b.msb - a.msb);
  const toggle = (p: "decode" | "history") => setPanel((cur) => (cur === p ? null : p));

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
          <Btn onClick={() => toggle("decode")} primary={panel === "decode"} className="ml-1">
            <IconCode size={12} /> decode
          </Btn>
          {project && modulePath && (
            <Btn onClick={() => toggle("history")} primary={panel === "history"}>
              <IconPulse size={12} /> history
            </Btn>
          )}
        </span>
      </div>

      {panel === "decode" && <RegisterDecoder reg={reg} />}
      {panel === "history" && project && modulePath && <RegHistory project={project} modulePath={modulePath} reg={reg.name} />}
      {project && used && used.length > 0 && <UsedBy project={project} used={used} />}

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
  project,
  regUsedBy,
}: {
  mod: SfrModule;
  highlightReg?: string | null;
  highlightField?: string | null;
  project?: string;
  regUsedBy?: Record<string, FnRef[]>;
}) {
  return (
    <div className="flex flex-col gap-4">
      {mod.regs.map((reg) => (
        <RegisterCard
          key={reg.name}
          reg={reg}
          flash={highlightReg === reg.name}
          highlightField={highlightReg === reg.name ? highlightField : null}
          project={project}
          modulePath={mod.path}
          regUsedBy={regUsedBy}
        />
      ))}
    </div>
  );
}
