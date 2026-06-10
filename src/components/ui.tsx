"use client";

import { type ReactNode, type SelectHTMLAttributes, useEffect, useRef, useState } from "react";
import { IconChevron, IconWarn } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

// ---------- primitives ----------

export function Card({ children, className, hover }: { children: ReactNode; className?: string; hover?: boolean }) {
  return (
    <div
      className={cx(
        "rounded-lg border border-neutral-200 bg-white",
        hover && "transition-all duration-200 hover:border-neutral-400 hover:shadow-[0_2px_12px_rgba(0,0,0,0.05)]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-400", className)}>
      {children}
    </div>
  );
}

const badgeStyles: Record<string, string> = {
  added: "bg-emerald-50 text-emerald-700 border-emerald-200",
  removed: "bg-red-50 text-red-700 border-red-200",
  modified: "bg-amber-50 text-amber-700 border-amber-200",
  doc: "bg-neutral-100 text-neutral-500 border-neutral-200",
  warn: "bg-red-50 text-red-600 border-red-200",
  neutral: "bg-neutral-100 text-neutral-600 border-neutral-200",
  dark: "bg-neutral-900 text-white border-neutral-900",
  outline: "bg-white text-neutral-600 border-neutral-300",
};

export function Badge({ kind = "neutral", children, className }: { kind?: string; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[10.5px] font-medium leading-4 whitespace-nowrap",
        badgeStyles[kind] ?? badgeStyles.neutral,
        className
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const label = { added: "+ added", removed: "− removed", modified: "~ modified", doc: "± doc only" }[status] ?? status;
  return <Badge kind={status}>{label}</Badge>;
}

export function WarnBadge({ drop }: { drop: number }) {
  return (
    <Badge kind="warn">
      <IconWarn size={11} /> −{drop}pp
    </Badge>
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cx("relative inline-flex items-center", className)}>
      <select
        {...props}
        className="h-7.5 w-full cursor-pointer appearance-none rounded-md border border-neutral-300 bg-white pr-7 pl-2.5 font-mono text-xs text-neutral-800 transition-colors outline-none hover:border-neutral-500 focus:border-neutral-900"
      >
        {children}
      </select>
      <IconChevron size={12} className="pointer-events-none absolute right-2 rotate-90 text-neutral-400" />
    </span>
  );
}

export function Btn({
  children,
  onClick,
  className,
  primary,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        "inline-flex h-7.5 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40",
        primary
          ? "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-700"
          : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500 hover:text-neutral-900 active:bg-neutral-50",
        className
      )}
    >
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="fade-in flex items-center gap-2.5 p-8 text-sm text-neutral-400">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-neutral-300 border-t-neutral-800" />
      {label ?? "Loading…"}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="fade-in m-4 rounded-lg border border-red-200 bg-red-50 p-4 font-mono text-xs text-red-700">
      {message}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="fade-in p-10 text-center text-sm text-neutral-400">{children}</div>;
}

// ---------- animated number ----------

export function useCountUp(target: number, duration = 500): number {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      fromRef.current = target;
      setVal(target);
      return;
    }
    const from = fromRef.current;
    fromRef.current = target;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setVal(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return val;
}

export function Kpi({
  label,
  value,
  unit,
  decimals = 0,
  sub,
  tone,
}: {
  label: ReactNode;
  value: number;
  unit?: string;
  decimals?: number;
  sub?: ReactNode;
  tone?: "warn" | "ok";
}) {
  const v = useCountUp(value);
  return (
    <Card className="px-4 py-3">
      <SectionLabel>{label}</SectionLabel>
      <div
        className={cx(
          "mt-1.5 font-mono text-[26px] leading-none font-semibold tracking-tight",
          tone === "warn" ? "text-red-600" : "text-neutral-900"
        )}
      >
        {v.toFixed(decimals)}
        {unit && <span className="ml-0.5 text-sm font-normal text-neutral-400">{unit}</span>}
      </div>
      {sub && <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-neutral-500">{sub}</div>}
    </Card>
  );
}

export function DeltaText({ value, invert }: { value: number; invert?: boolean }) {
  if (value === 0) return <span className="text-neutral-400">±0.0pp</span>;
  const good = invert ? value < 0 : value > 0;
  return (
    <span className={cx("font-mono", good ? "text-emerald-600" : "text-red-600")}>
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}pp
    </span>
  );
}

// ---------- hover tooltip ----------

export function HoverTip({ tip, children, className }: { tip: ReactNode; children: ReactNode; className?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      className={className}
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && (
        <span
          className="pop-in pointer-events-none fixed z-50 max-w-72 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[11px] leading-relaxed text-neutral-100 shadow-xl"
          style={{
            left: Math.min(pos.x + 12, typeof window !== "undefined" ? window.innerWidth - 300 : pos.x),
            top: pos.y + 14,
          }}
        >
          {tip}
        </span>
      )}
    </span>
  );
}
