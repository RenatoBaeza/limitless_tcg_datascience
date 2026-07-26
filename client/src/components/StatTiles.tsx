import type { DeckSummary, MatchupCell } from "../api";
import { count, percentSign, spansEven } from "../format";

/**
 * Three headline numbers. Each is one figure, so it is a stat tile and not a
 * one-bar bar chart.
 *
 * "Best performing" and "most lopsided" both ignore anything whose interval
 * still spans 50%, because otherwise both would be won every time by whichever
 * deck happened to go 3-0 somewhere.
 */
export function StatTiles({ decks, cells }: { decks: DeckSummary[]; cells: MatchupCell[] }) {
  const mostPlayed = decks.reduce<DeckSummary | null>(
    (best, deck) => (!best || deck.entries > best.entries ? deck : best),
    null,
  );

  const bestPerforming = decks
    .filter((deck) => !spansEven(deck.score_low, deck.score_high))
    .reduce<DeckSummary | null>(
      (best, deck) => (!best || (deck.score_rate ?? 0) > (best.score_rate ?? 0) ? deck : best),
      null,
    );

  const name = new Map(decks.map((deck) => [deck.deck_id, deck.deck_name ?? deck.deck_id]));
  const mostLopsided = cells
    .filter((cell) => !spansEven(cell.score_low, cell.score_high))
    .reduce<MatchupCell | null>(
      (best, cell) => (!best || (cell.score_rate ?? 0) > (best.score_rate ?? 0) ? cell : best),
      null,
    );

  return (
    <div className="tiles">
      <div className="tile">
        <span className="tile-label">Most played</span>
        <span className="tile-value">{percentSign(mostPlayed?.meta_share ?? null, 1)}</span>
        <span className="tile-sub">
          {mostPlayed ? `${mostPlayed.deck_name} · ${count(mostPlayed.entries)} entries` : "—"}
        </span>
      </div>

      <div className="tile">
        <span className="tile-label">Best score rate</span>
        <span className="tile-value">{percentSign(bestPerforming?.score_rate ?? null)}</span>
        <span className="tile-sub">
          {bestPerforming
            ? `${bestPerforming.deck_name} · ${count(bestPerforming.matches)} matches`
            : "no deck clears 50% conclusively"}
        </span>
      </div>

      <div className="tile">
        <span className="tile-label">Most lopsided matchup</span>
        <span className="tile-value">{percentSign(mostLopsided?.score_rate ?? null)}</span>
        <span className="tile-sub">
          {mostLopsided
            ? `${name.get(mostLopsided.deck_a)} over ${name.get(mostLopsided.deck_b)} · ${count(
                mostLopsided.matches,
              )} matches`
            : "—"}
        </span>
      </div>
    </div>
  );
}
