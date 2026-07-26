import type { DeckSummary, MatchupCell } from "../api";
import { count, percentSign, record } from "../format";

/**
 * The matrix as rows — the WCAG-clean twin of the heatmap.
 *
 * Not a fallback but a peer view: sorted by sample size it answers "which
 * matchups do we actually know about", which the grid cannot show at a glance.
 */
export function MatchupTable({
  decks,
  cells,
  onSelect,
}: {
  decks: DeckSummary[];
  cells: MatchupCell[];
  onSelect: (deckId: string) => void;
}) {
  const name = new Map(decks.map((deck) => [deck.deck_id, deck.deck_name ?? deck.deck_id]));
  const rows = [...cells].sort((a, b) => b.matches - a.matches);

  if (!rows.length) {
    return <p className="notice">No matchups meet the current filters.</p>;
  }

  return (
    <div className="table-scroll">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Deck</th>
            <th scope="col">Opponent</th>
            <th scope="col">Matches</th>
            <th scope="col">W-L-T</th>
            <th scope="col">Score rate</th>
            <th scope="col">95% range</th>
            <th scope="col">Excl. ties</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((cell) => (
            <tr key={`${cell.deck_a} ${cell.deck_b}`}>
              <td>
                <div className="deck-cell">
                  <button type="button" onClick={() => onSelect(cell.deck_a)}>
                    {name.get(cell.deck_a) ?? cell.deck_a}
                  </button>
                </div>
              </td>
              <td style={{ textAlign: "left" }} className="secondary">
                {name.get(cell.deck_b) ?? cell.deck_b}
              </td>
              <td>{count(cell.matches)}</td>
              <td>{record(cell.wins, cell.losses, cell.ties)}</td>
              <td>
                <strong>{percentSign(cell.score_rate)}</strong>
              </td>
              <td className="muted">
                {percentSign(cell.score_low, 0)}–{percentSign(cell.score_high, 0)}
              </td>
              <td className="secondary">{percentSign(cell.win_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
