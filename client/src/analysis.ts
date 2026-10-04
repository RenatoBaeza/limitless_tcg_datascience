/**
 * The offline metagame analysis, typed: public/analysis.json, written by
 * server/scripts/analyze_meta.py (`report.as_json`). Change both together.
 *
 * Unlike everything in api.ts this is not live. It is a snapshot taken when
 * the script last ran, shipped as a static file beside the deck sprites, so
 * the Insights view always says when it was computed and over which period.
 */

import type { Period } from "./api";

export type DeckRate = { deck_id: string; rate: number | null; matches: number };

export type Archetypes = {
  k: number;
  /** Mean silhouette width of the chosen clustering, -1..1. Under 0.25 is weak. */
  silhouette: number;
  /** Share of profile variance on the plot's x and y axes. */
  explained: [number, number];
  decks: Array<{
    deck_id: string;
    share: number;
    /** 0-based; cluster 0 holds the most meta share. */
    cluster: number;
    /** How often the deck lands with its cluster when the matches are resampled. */
    stability: number;
    x: number;
    y: number;
  }>;
  clusters: Array<{ share: number; stability: number; best: DeckRate[]; worst: DeckRate[] }>;
  /** Pooled score rate, row cluster against column cluster. */
  cross: Array<Array<{ rate: number | null; matches: number }>>;
};

export type Cycles = {
  /** Shares of the matchup matrix, summing to 1. */
  transitive: number;
  cyclic: number;
  noise: number;
  p_value: number;
  sims: number;
  /** Share of the cyclic part the ring's one pattern holds. */
  ring_captured: number;
  /** Strongest first. `strength` is the expected score against an average deck. */
  ladder: Array<{ deck_id: string; share: number; strength: number; matches: number }>;
  /** Sorted by angle: each deck tends to beat the ones after it. */
  ring: Array<{ deck_id: string; angle: number; pull: number }>;
  /** Observed score rate of `a` against `b`, both directions present. */
  ring_pairs: Array<{ a: string; b: string; rate: number; matches: number }>;
  triangle_count: number;
  /** Significant triangles pure noise produces, on average. */
  triangle_null: number;
  /** decks[0] beats decks[1] beats decks[2] beats decks[0]; rates in that order. */
  triangles: Array<{
    decks: [string, string, string];
    rates: [number, number, number];
    matches: [number, number, number];
    z: number;
  }>;
};

export type Shifts = {
  /** ISO Monday of each week. Every week index below points into this. */
  weeks: string[];
  flag_z: number;
  weekly: Array<{
    week: number;
    /** Jensen-Shannon divergence from the week before, in bits. */
    divergence: number;
    z: number;
    changes: number;
    movers: Array<{ deck_id: string; before: number; after: number }>;
  }>;
  trends: Array<{
    deck_id: string;
    direction: "rising" | "new" | "fading";
    since: number;
    before: number;
    after: number;
  }>;
  timelines: Array<{
    deck_id: string;
    /** Raw weekly meta share, one per week; null in a week with no entries at all. */
    share: Array<number | null>;
    /** The fitted levels; `end` is one past the last week. */
    levels: Array<{ start: number; end: number; rate: number }>;
  }>;
};

export type Analysis = {
  generated: string;
  period: Period;
  /** Distinct matches between the top decks the matrix analyses read. */
  matches: number;
  decks: Record<string, string>;
  archetypes?: Archetypes;
  cycles?: Cycles;
  shifts?: Shifts;
};

export async function fetchAnalysis(): Promise<Analysis> {
  const response = await fetch("/analysis.json");
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from /analysis.json`);
  return response.json() as Promise<Analysis>;
}
