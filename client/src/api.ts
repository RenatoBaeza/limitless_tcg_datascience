/**
 * The FastAPI service, typed. One function per endpoint, one type per response
 * model in server/app/models.py.
 *
 * In dev the base is /api and Vite proxies it, so the browser stays on one
 * origin. Set VITE_API_URL to talk to a deployed API instead.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

/**
 * The windows the server precomputes - the rows of gold_periods. Every panel is
 * read for exactly one of them; there is no arbitrary date range.
 */
export type Period = "3d" | "7d" | "30d" | "60d" | "90d" | "all";

export type Coverage = {
  first_event: string | null;
  last_event: string | null;
  tournaments: number;
  decks: number;
  matches: number;
  /** Tournaments with fewer matches than this are left out of every number. */
  min_matches: number;
  refreshed_at: string | null;
};

/** Shared by every rate the API returns. */
type Rated = {
  matches: number;
  wins: number;
  losses: number;
  ties: number;
  /** wins / (wins + losses). Null when a cell is all ties. */
  win_rate: number | null;
  /** (wins + ties/2) / matches. The headline number. */
  score_rate: number | null;
  /** 95% Wilson bounds on score_rate. */
  score_low: number | null;
  score_high: number | null;
};

export type DeckSummary = Rated & {
  deck_id: string;
  deck_name: string | null;
  /** 1 is the most played deck in the period. */
  rank: number;
  entries: number;
  tournaments: number;
  meta_share: number | null;
  /** Left out of every rate, counted here. */
  mirror_matches: number;
  champions: number;
  top8: number;
};

export type MatchupCell = Rated & {
  deck_a: string;
  deck_b: string;
};

export type DeckMatchup = Rated & {
  deck_b: string;
  deck_name: string | null;
};

type Param = string | number | boolean | undefined | string[];

async function get<T>(path: string, params: Record<string, Param> = {}): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => query.append(key, v));
    else query.set(key, String(value));
  }

  const url = `${API_BASE}${path}${query.size ? `?${query}` : ""}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${path}`);
  }
  return response.json() as Promise<T>;
}

export const fetchCoverage = () => get<Coverage>("/coverage");

// The period is the only parameter. The server fixes the rest: the top 50
// decks, every cell with at least one match, and never 'other'.

export const fetchDecks = (period: Period) => get<DeckSummary[]>("/decks", { period });

export const fetchMatrix = (period: Period) => get<MatchupCell[]>("/matchups", { period });

export const fetchDeckMatchups = (deckId: string, period: Period) =>
  get<DeckMatchup[]>(`/decks/${encodeURIComponent(deckId)}/matchups`, { period });

/** Composited deck image, written by server/scripts/download_deck_sprites.py. */
export const deckImage = (deckId: string) => `/decks/${encodeURIComponent(deckId)}.png`;
