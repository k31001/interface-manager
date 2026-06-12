import { cx } from "./ui";

/**
 * "Bit" — the Interface Manager mascot: a friendly little SoC die.
 * A rounded chip body with bond-out pins, two eyes and a small smile.
 * Pure black & white, themeable via currentColor (pins) + the chip fill.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("im-logo inline-grid place-items-center", className)}>
      <svg viewBox="0 0 40 40" width={40} height={40} fill="none" className="h-full w-full" aria-hidden>
        {/* bond-out pins */}
        <g className="im-pins" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
          <path d="M14 3.5v4M26 3.5v4" />
          <path d="M14 32.5v4M26 32.5v4" />
          <path d="M3.5 14h4M3.5 26h4" />
          <path d="M32.5 14h4M32.5 26h4" />
        </g>
        {/* chip body */}
        <rect x="7" y="7" width="26" height="26" rx="7.5" className="fill-neutral-900" />
        {/* inner die outline */}
        <rect x="11.5" y="11.5" width="17" height="17" rx="4.5" stroke="#fff" strokeOpacity="0.18" strokeWidth="1.2" />
        {/* eyes */}
        <g className="im-eyes" fill="#fff">
          <rect x="15" y="17" width="3.4" height="4.6" rx="1.7" />
          <rect x="21.6" y="17" width="3.4" height="4.6" rx="1.7" />
        </g>
        {/* smile */}
        <path d="M16.4 25c1.3 1.5 5.9 1.5 7.2 0" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" fill="none" />
      </svg>
    </span>
  );
}
