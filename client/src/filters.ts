import type { Period } from "./api";
import type { MessageKey } from "./locales/en";

export type View = "matrix" | "table";

/**
 * One preset per row of gold_periods, which the server computes ahead of time.
 *
 * Each window counts back from the last event in the data rather than from
 * today, and the server works that out when it builds the period. That
 * difference is not cosmetic: results land days after an event happens, so
 * "the last 30 days" from today's date would quietly clip the most recent
 * weekend off the window.
 */
export const PRESETS: Record<Period, { label: MessageKey }> = {
  "30d": { label: "period30d" },
  "90d": { label: "period90d" },
  // Everything in the retention window - six months (RETAIN_MONTHS). A
  // separate "last 180 days" preset was the same window give or take three
  // days, so it was dropped (sql/013_drop_180d_period.sql).
  all: { label: "periodAll" },
};

export type Filters = {
  period: Period;
  /** How many decks on each axis of the matrix. */
  axis: number;
  /** Cells below this many matches are dropped rather than drawn as noise. */
  minMatches: number;
  includeOther: boolean;
};

export const DEFAULT_FILTERS: Filters = {
  period: "90d",
  axis: 20,
  minMatches: 20,
  includeOther: false,
};
