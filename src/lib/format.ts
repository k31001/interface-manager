export const hex = (n: number, pad = 0) => "0x" + n.toString(16).toUpperCase().padStart(pad, "0");

export const fmtDate = (iso: string) => iso.slice(0, 10);

export function fmtRelDays(days: number): string {
  if (days < 7) return `D+${days}`;
  const weeks = Math.floor(days / 7);
  return `W${weeks}`;
}

export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d < 1) return "today";
  if (d === 1) return "1 day ago";
  if (d < 30) return `${d} days ago`;
  const mo = Math.floor(d / 30);
  return mo === 1 ? "1 month ago" : `${mo} months ago`;
}

export function bitsLabel(msb: number, lsb: number): string {
  return msb === lsb ? `[${lsb}]` : `[${msb}:${lsb}]`;
}
