import type { Period } from "./api";
import type { MessageKey } from "./locales/en";

/**
 * One preset per row of gold_periods, which the server computes ahead of time,
 * shortest first.
 *
 * Each window counts back from the last event in the data rather than from
 * today, and the server works that out when it builds the period. That
 * difference is not cosmetic: results land days after an event happens, so
 * "the last 30 days" from today's date would quietly clip the most recent
 * weekend off the window.
 *
 * The period is the only thing a reader chooses. The matrix is always the top
 * 50 decks, every cell with a match is drawn (a thin one is muted by its
 * interval, not hidden), and 'other' is never shown - the server fixes all
 * three.
 */
export const PRESETS: Record<Period, { label: MessageKey }> = {
  "3d": { label: "period3d" },
  "7d": { label: "period7d" },
  "30d": { label: "period30d" },
  "60d": { label: "period60d" },
  "90d": { label: "period90d" },
  // Everything in the retention window - six months (RETAIN_MONTHS).
  all: { label: "periodAll" },
};

export const DEFAULT_PERIOD: Period = "30d";
