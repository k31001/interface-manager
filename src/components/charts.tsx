"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "./ui";

export interface ChartPoint {
  x: number;
  y: number;
  label?: string; // e.g. tag name
  warn?: number; // drop in pp when this point triggered a warning
  meta?: string;
}

export interface ChartSeries {
  id: string;
  label: string;
  points: ChartPoint[];
  color?: string;
  dashed?: boolean;
  marker?: "circle" | "square";
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(720);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceTicks(min: number, max: number, n = 5): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? mag * 10;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

export function LineChart({
  series,
  height = 260,
  yDomain,
  fmtX = (x) => `${x}`,
  fmtY = (y) => `${y}`,
  xLabel,
  unit = "",
  showPointLabels,
  onPointClick,
}: {
  series: ChartSeries[];
  height?: number;
  yDomain?: [number, number];
  fmtX?: (x: number) => string;
  fmtY?: (y: number) => string;
  xLabel?: string;
  unit?: string;
  showPointLabels?: boolean;
  /** called with the nearest point when the plot is clicked */
  onPointClick?: (p: ChartPoint) => void;
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; px: number; py: number } | null>(null);

  const pad = { l: 44, r: 16, t: 14, b: 30 };
  const iw = Math.max(80, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;

  const allPts = series.flatMap((s) => s.points);
  const xMin = Math.min(...allPts.map((p) => p.x), 0);
  const xMax = Math.max(...allPts.map((p) => p.x), 1);
  let yMin = yDomain?.[0] ?? Math.min(...allPts.map((p) => p.y));
  let yMax = yDomain?.[1] ?? Math.max(...allPts.map((p) => p.y));
  if (!yDomain) {
    const margin = Math.max((yMax - yMin) * 0.15, 1);
    yMin = Math.max(0, yMin - margin);
    yMax = yMax + margin;
  }

  const X = (x: number) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * iw;
  const Y = (y: number) => pad.t + (1 - (y - yMin) / (yMax - yMin || 1)) * ih;

  const yTicks = niceTicks(yMin, yMax, 5);
  const xTicks = niceTicks(xMin, xMax, Math.min(8, Math.floor(iw / 90)));

  const paths = useMemo(
    () =>
      series.map((s) => ({
        s,
        d: s.points
          .slice()
          .sort((a, b) => a.x - b.x)
          .map((p, i) => `${i === 0 ? "M" : "L"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`)
          .join(" "),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, width, height, yMin, yMax, xMin, xMax]
  );

  // hover: nearest point by x
  const hoverInfo = useMemo(() => {
    if (!hover) return null;
    let best: { px: number; dist: number; x: number } | null = null;
    for (const s of series)
      for (const p of s.points) {
        const d = Math.abs(X(p.x) - hover.px);
        if (!best || d < best.dist) best = { px: X(p.x), dist: d, x: p.x };
      }
    if (!best || best.dist > 40) return null;
    const items = series
      .map((s) => {
        const p = s.points.find((q) => q.x === best!.x);
        return p ? { s, p } : null;
      })
      .filter(Boolean) as { s: ChartSeries; p: ChartPoint }[];
    return { x: best.x, px: best.px, items };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, series, width]);

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      <svg
        width="100%"
        height={height}
        className={onPointClick ? "cursor-pointer" : undefined}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHover({ x: e.clientX, px: e.clientX - rect.left, py: e.clientY - rect.top });
        }}
        onMouseLeave={() => setHover(null)}
        onClick={() => {
          if (onPointClick && hoverInfo?.items[0]) onPointClick(hoverInfo.items[0].p);
        }}
      >
        {/* grid */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={pad.l} x2={pad.l + iw} y1={Y(t)} y2={Y(t)} stroke="#e8e8e8" strokeWidth={1} />
            <text x={pad.l - 8} y={Y(t) + 3.5} textAnchor="end" fontSize={10} fill="#a3a3a3" fontFamily="var(--font-geist-mono)">
              {fmtY(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={X(t)} y={height - 10} textAnchor="middle" fontSize={10} fill="#a3a3a3" fontFamily="var(--font-geist-mono)">
            {fmtX(t)}
          </text>
        ))}
        {xLabel && (
          <text x={pad.l + iw} y={height - 10} textAnchor="end" fontSize={9} fill="#d4d4d4">
            {xLabel}
          </text>
        )}

        {/* crosshair */}
        {hoverInfo && (
          <line x1={hoverInfo.px} x2={hoverInfo.px} y1={pad.t} y2={pad.t + ih} stroke="#0a0a0a" strokeWidth={1} strokeDasharray="3 3" opacity={0.35} />
        )}

        {/* series */}
        {paths.map(({ s, d }) => (
          <g key={s.id}>
            <path
              d={d}
              fill="none"
              stroke={s.color ?? "#0a0a0a"}
              strokeWidth={1.8}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              className={s.dashed ? undefined : "draw-line"}
              style={{ ["--dash" as string]: 1600 }}
            />
            {s.points.map((p) => (
              <g key={`${s.id}-${p.x}`}>
                {s.marker === "square" ? (
                  <rect
                    x={X(p.x) - 2.8}
                    y={Y(p.y) - 2.8}
                    width={5.6}
                    height={5.6}
                    fill="#fff"
                    stroke={s.color ?? "#0a0a0a"}
                    strokeWidth={1.5}
                  />
                ) : (
                  <circle
                    cx={X(p.x)}
                    cy={Y(p.y)}
                    r={hoverInfo?.x === p.x ? 4 : 2.8}
                    fill="#fff"
                    stroke={s.color ?? "#0a0a0a"}
                    strokeWidth={1.5}
                    style={{ transition: "r 0.15s" }}
                  />
                )}
                {p.warn !== undefined && (
                  <g transform={`translate(${X(p.x)},${Y(p.y) - 13})`}>
                    <path d="M0 -4 L4.5 3.5 L-4.5 3.5 Z" fill="#dc2626" />
                  </g>
                )}
                {showPointLabels && p.label && (
                  <text x={X(p.x)} y={pad.t + ih + 0} fontSize={8.5} fill="#c4c4c4" textAnchor="middle" fontFamily="var(--font-geist-mono)">
                    {""}
                  </text>
                )}
              </g>
            ))}
          </g>
        ))}
      </svg>

      {/* tooltip */}
      {hoverInfo && (
        <div
          className="pop-in pointer-events-none absolute z-20 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-[11px] text-neutral-100 shadow-xl"
          style={{
            left: Math.min(hoverInfo.px + 12, width - 190),
            top: 8,
          }}
        >
          <div className="mb-1 font-mono text-[10px] text-neutral-400">
            {hoverInfo.items[0]?.p.label ?? fmtX(hoverInfo.x)} · {fmtX(hoverInfo.x)}
          </div>
          {hoverInfo.items.map(({ s, p }) => (
            <div key={s.id} className="flex items-center gap-2 py-px">
              <span
                className="inline-block h-0 w-3.5 border-t-2"
                style={{ borderColor: s.color ?? "#fff", borderStyle: s.dashed ? "dashed" : "solid" }}
              />
              <span className="text-neutral-300">{s.label}</span>
              <span className="ml-auto pl-3 font-mono font-semibold">
                {fmtY(p.y)}
                {unit}
              </span>
              {p.warn !== undefined && <span className="font-mono text-red-400">▲−{p.warn}pp</span>}
            </div>
          ))}
          {onPointClick && (
            <div className="mt-1 border-t border-neutral-700 pt-1 text-[10px] text-neutral-400">
              click to open changelog →
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ points, width = 120, height = 34, color = "#0a0a0a" }: { points: { x: number; y: number }[]; width?: number; height?: number; color?: string }) {
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys) - 2;
  const yMax = Math.max(...ys) + 2;
  const X = (x: number) => 2 + ((x - xMin) / (xMax - xMin || 1)) * (width - 4);
  const Y = (y: number) => 2 + (1 - (y - yMin) / (yMax - yMin || 1)) * (height - 4);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={`${d} L${X(last.x)},${height} L${X(points[0].x)},${height} Z`} fill={color} opacity={0.05} stroke="none" />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
      <circle cx={X(last.x)} cy={Y(last.y)} r={2.5} fill={color} />
    </svg>
  );
}

export function ScatterChart({
  groups,
  height = 280,
  fmtX = (x) => `${x}`,
  fmtY = (y) => `${y}`,
  xTitle,
  yTitle,
}: {
  groups: { id: string; label: string; color?: string; hollow?: boolean; points: { x: number; y: number; label?: string }[] }[];
  height?: number;
  fmtX?: (x: number) => string;
  fmtY?: (y: number) => string;
  xTitle?: string;
  yTitle?: string;
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ gx: number; gy: number; text: string } | null>(null);
  const pad = { l: 44, r: 14, t: 12, b: 34 };
  const iw = Math.max(80, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const all = groups.flatMap((g) => g.points);
  if (!all.length) return null;
  const xMin = Math.min(...all.map((p) => p.x)) - 2;
  const xMax = Math.max(...all.map((p) => p.x)) + 2;
  const yMin = Math.min(...all.map((p) => p.y)) - 2;
  const yMax = Math.max(...all.map((p) => p.y)) + 2;
  const X = (x: number) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * iw;
  const Y = (y: number) => pad.t + (1 - (y - yMin) / (yMax - yMin || 1)) * ih;

  const lo = Math.max(xMin, yMin);
  const hi = Math.min(xMax, yMax);

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      <svg width="100%" height={height}>
        {niceTicks(yMin, yMax, 5).map((t) => (
          <g key={`y${t}`}>
            <line x1={pad.l} x2={pad.l + iw} y1={Y(t)} y2={Y(t)} stroke="#e8e8e8" />
            <text x={pad.l - 8} y={Y(t) + 3.5} textAnchor="end" fontSize={10} fill="#a3a3a3" fontFamily="var(--font-geist-mono)">
              {fmtY(t)}
            </text>
          </g>
        ))}
        {niceTicks(xMin, xMax, 6).map((t) => (
          <text key={`x${t}`} x={X(t)} y={height - 16} textAnchor="middle" fontSize={10} fill="#a3a3a3" fontFamily="var(--font-geist-mono)">
            {fmtX(t)}
          </text>
        ))}
        {/* identity line: y = x */}
        {hi > lo && (
          <line x1={X(lo)} y1={Y(lo)} x2={X(hi)} y2={Y(hi)} stroke="#d4d4d4" strokeDasharray="4 4" />
        )}
        {groups.map((g) =>
          g.points.map((p, i) => (
            <circle
              key={`${g.id}${i}`}
              cx={X(p.x)}
              cy={Y(p.y)}
              r={4}
              fill={g.hollow ? "#fff" : (g.color ?? "#0a0a0a")}
              stroke={g.color ?? "#0a0a0a"}
              strokeWidth={1.5}
              className="cursor-pointer transition-all hover:r-6"
              onMouseEnter={() => setHover({ gx: X(p.x), gy: Y(p.y), text: `${g.label} ${p.label ?? ""} — ${fmtX(p.x)} / ${fmtY(p.y)}` })}
              onMouseLeave={() => setHover(null)}
            />
          ))
        )}
        {xTitle && (
          <text x={pad.l + iw / 2} y={height - 2} textAnchor="middle" fontSize={9.5} fill="#a3a3a3">
            {xTitle}
          </text>
        )}
        {yTitle && (
          <text x={12} y={pad.t + ih / 2} textAnchor="middle" fontSize={9.5} fill="#a3a3a3" transform={`rotate(-90 12 ${pad.t + ih / 2})`}>
            {yTitle}
          </text>
        )}
      </svg>
      {hover && (
        <div
          className="pop-in pointer-events-none absolute z-20 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 font-mono text-[10.5px] whitespace-nowrap text-neutral-100 shadow-xl"
          style={{ left: Math.min(hover.gx + 10, width - 220), top: hover.gy - 34 }}
        >
          {hover.text}
        </div>
      )}
    </div>
  );
}

export function ChartLegend({ items }: { items: { label: string; color?: string; dashed?: boolean; marker?: "circle" | "square" }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-600">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <svg width="22" height="10">
            <line x1="0" y1="5" x2="22" y2="5" stroke={it.color ?? "#0a0a0a"} strokeWidth={1.8} strokeDasharray={it.dashed ? "4 3" : undefined} />
            {it.marker === "square" ? (
              <rect x="8" y="2" width="6" height="6" fill="#fff" stroke={it.color ?? "#0a0a0a"} strokeWidth={1.3} />
            ) : (
              <circle cx="11" cy="5" r="3" fill="#fff" stroke={it.color ?? "#0a0a0a"} strokeWidth={1.3} />
            )}
          </svg>
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function cxChart(...parts: (string | false | null | undefined)[]) {
  return cx(...parts);
}
