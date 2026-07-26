import type { Window } from "./api";
import { daysBefore } from "./format";

export type Preset = "30d" | "90d" | "180d" | "all";
export type View = "matrix" | "table";

export const PRESETS: Record<Preset, { label: string; days: number | null }> = {
  "30d": { label: "Last 30 days", days: 30 },
  "90d": { label: "Last 90 days", days: 90 },
  "180d": { label: "Last 6 months", days: 180 },
  all: { label: "All time", days: null },
};

export type Filters = {
  preset: Preset;
  /** How many decks on each axis of the matrix. */
  axis: number;
  /** Cells below this many matches are dropped rather than drawn as noise. */
  minMatches: number;
  includeOther: boolean;
};

export const DEFAULT_FILTERS: Filters = {
  preset: "90d",
  axis: 20,
  minMatches: 20,
  includeOther: false,
};

/**
 * Turn a preset into a date window, counted back from the last event in the
 * data rather than from today.
 *
 * That difference is not cosmetic. The ingest runs every six hours and a
 * tournament's results land days after it happens, so "the last 30 days" from
 * today's date can quietly clip the most recent weekend off the window.
 */
export function windowFor(preset: Preset, lastEvent: string | null): Window {
  const { days } = PRESETS[preset];
  if (days == null || !lastEvent) return {};
  return { from: daysBefore(lastEvent, days), to: lastEvent };
}
