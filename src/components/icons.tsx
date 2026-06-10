import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...props }: P) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export const IconChevron = (p: P) => (
  <svg {...base(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);
export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
export const IconGrid = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);
export const IconChip = (p: P) => (
  <svg {...base(p)}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
    <rect x="10" y="10" width="4" height="4" />
    <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
  </svg>
);
export const IconCode = (p: P) => (
  <svg {...base(p)}>
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
  </svg>
);
export const IconDelta = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4 21 20H3L12 4Z" />
  </svg>
);
export const IconPulse = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 12h4l2.5-7 5 14 2.5-7h4" />
  </svg>
);
export const IconCompare = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v18" strokeDasharray="2.5 3" />
    <rect x="3" y="7" width="6" height="10" rx="1" />
    <rect x="15" y="5" width="6" height="14" rx="1" />
  </svg>
);
export const IconGear = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19 12a7 7 0 0 0-.14-1.4l2.1-1.62-2-3.46-2.49 1a7 7 0 0 0-2.42-1.4L13.7 2.5h-3.4l-.35 2.62a7 7 0 0 0-2.42 1.4l-2.49-1-2 3.46 2.1 1.62a7 7 0 0 0 0 2.8l-2.1 1.62 2 3.46 2.49-1a7 7 0 0 0 2.42 1.4l.35 2.62h3.4l.35-2.62a7 7 0 0 0 2.42-1.4l2.49 1 2-3.46-2.1-1.62A7 7 0 0 0 19 12Z" />
  </svg>
);
export const IconWarn = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3 22 20H2L12 3Z" />
    <path d="M12 9.5v4.5" />
    <path d="M12 17.2v.01" strokeWidth={2.4} />
  </svg>
);
export const IconTag = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z" />
    <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);
export const IconDoc = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 2h8l4 4v16H6V2Z" />
    <path d="M14 2v4h4M9 12h6M9 16h6" />
  </svg>
);
export const IconArrowRight = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 12h16m-6-6 6 6-6 6" />
  </svg>
);
export const IconSwap = (p: P) => (
  <svg {...base(p)}>
    <path d="M16 3l4 4-4 4M20 7H7M8 21l-4-4 4-4M4 17h13" />
  </svg>
);
export const IconX = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 5 14 14M19 5 5 19" />
  </svg>
);
export const IconRefresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 11a8 8 0 1 0-2.34 6.34" />
    <path d="M20 5v6h-6" />
  </svg>
);
export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconBox = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z" />
    <path d="m3.5 7.5 8.5 5 8.5-5M12 12.5V22" />
  </svg>
);
export const IconFolder = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 6a1 1 0 0 1 1-1h5l2 2.5h9a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z" />
  </svg>
);
export const IconFn = (p: P) => (
  <svg {...base(p)}>
    <path d="M17 4c-4 0-4.5 2.5-5 6m0 0c-.5 3.5-1 6-5 6m5-6H7m5 0h5" />
  </svg>
);
export const IconCommit = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 2v6.5M12 15.5V22" />
  </svg>
);
