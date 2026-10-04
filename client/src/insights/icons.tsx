/** Panel glyphs for the Insights view, drawn to sit in the yellow energy disc. */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Three arrows chasing each other round: rock-paper-scissors. */
export const CycleIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" {...stroke}>
    <path d="M10 3.2a6.8 6.8 0 0 1 5.9 3.4" />
    <path d="M16.4 12.4a6.8 6.8 0 0 1-6.4 4.4" />
    <path d="M6.3 15.8A6.8 6.8 0 0 1 3.4 8.6" />
    <path d="M14.3 6.9l1.7-.3.3-1.8M11.6 17.4l-1.6-.6.6-1.6M3.2 10.4l.1-1.8 1.8.4" />
  </svg>
);

export const TriangleIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" {...stroke}>
    <path d="M10 3.5l6.5 11.5h-13z" />
    <circle cx="10" cy="3.5" r="1.6" fill="currentColor" />
    <circle cx="16.5" cy="15" r="1.6" fill="currentColor" />
    <circle cx="3.5" cy="15" r="1.6" fill="currentColor" />
  </svg>
);

export const StrengthIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" {...stroke}>
    <path d="M3 16.5h14" />
    <path d="M5 16.5v-4M9 16.5v-7M13 16.5v-10" strokeWidth="2.6" />
  </svg>
);

export const GroupIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" {...stroke}>
    <circle cx="6.5" cy="7" r="3" />
    <rect x="11" y="10.5" width="5.5" height="5.5" rx="1" />
    <circle cx="5" cy="14.5" r="1.4" fill="currentColor" />
    <rect x="12.5" y="4" width="3" height="3" rx="0.6" fill="currentColor" />
  </svg>
);

export const ShiftIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" {...stroke}>
    <path d="M2.5 14h3l2-6 3 9 2.5-12 2 9h2.5" />
  </svg>
);

/** A flask: the badge on the snapshot strip. */
export const LabIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" {...stroke} strokeWidth={1.5}>
    <path d="M6 1.8h4M6.6 1.8v4.4L2.9 12.6a1.2 1.2 0 0 0 1 1.8h8.2a1.2 1.2 0 0 0 1-1.8L9.4 6.2V1.8" />
    <path d="M4.6 10h6.8" />
  </svg>
);
