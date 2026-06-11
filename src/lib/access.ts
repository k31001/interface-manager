/**
 * Classify a field's software-access token into a semantic category and a
 * consistent color, used to highlight special access (RO / WO / W1C / read-clear)
 * in the register map and the register tables.
 */
export type AccessKind = "rw" | "ro" | "wo" | "w1c" | "rclr" | "wonce" | "na";

export interface AccessStyle {
  kind: AccessKind;
  label: string; // short uppercase tag
  /** badge classes (text/bg/border) */
  badge: string;
  /** accent hex for the bit-cell underline (empty for the neutral rw case) */
  accent: string;
  title: string; // human description for tooltips/legend
}

const STYLES: Record<AccessKind, Omit<AccessStyle, "kind">> = {
  rw: { label: "RW", badge: "text-neutral-500 bg-neutral-100 border-neutral-200", accent: "", title: "read-write" },
  ro: { label: "RO", badge: "text-sky-700 bg-sky-50 border-sky-200", accent: "#0ea5e9", title: "read-only" },
  wo: { label: "WO", badge: "text-amber-700 bg-amber-50 border-amber-200", accent: "#f59e0b", title: "write-only" },
  w1c: { label: "W1C", badge: "text-violet-700 bg-violet-50 border-violet-200", accent: "#8b5cf6", title: "write-one-to-clear / set (sticky)" },
  rclr: { label: "RC", badge: "text-teal-700 bg-teal-50 border-teal-200", accent: "#14b8a6", title: "read-clears / read-sets" },
  wonce: { label: "W1", badge: "text-rose-700 bg-rose-50 border-rose-200", accent: "#f43f5e", title: "write-once" },
  na: { label: "NA", badge: "text-neutral-400 bg-neutral-50 border-neutral-200", accent: "#d4d4d4", title: "no access" },
};

export function classifyAccess(sw: string | undefined): AccessKind {
  const s = (sw ?? "rw").toLowerCase();
  if (s === "na") return "na";
  // write-one/zero-to-clear/set, toggle (sticky-style) — e.g. rw1c, w1c, rw1s, 0c, clr, set, 1t
  if (/(1c|0c|1s|0s|1t|0t|clr|set)/.test(s)) return "w1c";
  // read-clears / read-sets
  if (/(rclr|rset|\/rc|\/rs)/.test(s)) return "rclr";
  // write-once
  if (s === "rw1" || s === "w1") return "wonce";
  if (s === "r") return "ro";
  if (s === "w" || s === "wo") return "wo";
  return "rw"; // rw, wr, anything else
}

export function accessStyle(sw: string | undefined): AccessStyle {
  const kind = classifyAccess(sw);
  return { kind, ...STYLES[kind] };
}

export interface AccessToken {
  token: string; // the actual access string, e.g. "rw1c"
  accent: string;
  badge: string;
  title: string;
}

/**
 * Distinct *special* (non-rw) access tokens present, keyed on the real token so a
 * legend shows e.g. "rw1c" — not a coarse category name like "w1c".
 */
export function specialAccessTokens(tokens: Iterable<string>): AccessToken[] {
  const seen = new Map<string, AccessToken>();
  for (const t of tokens) {
    const s = (t ?? "rw").toLowerCase();
    const style = accessStyle(s);
    if (style.kind === "rw") continue; // skip the common case
    if (!seen.has(s)) seen.set(s, { token: s, accent: style.accent, badge: style.badge, title: style.title });
  }
  return [...seen.values()].sort((a, b) => a.token.localeCompare(b.token));
}
