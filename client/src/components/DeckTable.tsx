import { useState } from "react";
import type { DeckSummary } from "../api";
import { count, percentSign, record } from "../format";
import { DeckIcon } from "./DeckIcon";

type Column = {
  key: keyof DeckSummary;
  label: string;
  render: (deck: DeckSummary) => React.ReactNode;
  className?: string;
};

const COLUMNS: Column[] = [
  { key: "meta_share", label: "Meta share", render: (d) => percentSign(d.meta_share, 2) },
  { key: "entries", label: "Entries", render: (d) => count(d.entries) },
  { key: "tournaments", label: "Events", render: (d) => count(d.tournaments) },
  { key: "matches", label: "Matches", render: (d) => count(d.matches) },
  { key: "wins", label: "W-L-T", render: (d) => record(d.wins, d.losses, d.ties) },
  {
    key: "score_rate",
    label: "Score rate",
    render: (d) => <strong>{percentSign(d.score_rate)}</strong>,
  },
  {
    key: "score_low",
    label: "95% range",
    className: "muted",
    render: (d) => `${percentSign(d.score_low, 0)}–${percentSign(d.score_high, 0)}`,
  },
  { key: "win_rate", label: "Excl. ties", className: "secondary", render: (d) => percentSign(d.win_rate) },
  { key: "champions", label: "Wins", render: (d) => count(d.champions) },
  { key: "top8", label: "Top 8", render: (d) => count(d.top8) },
];

/**
 * The deck list. Sortable because the two orderings people want — most played
 * and best performing — are genuinely different questions, and a deck that is
 * high on one and low on the other is the interesting case.
 */
export function DeckTable({
  decks,
  selected,
  onSelect,
}: {
  decks: DeckSummary[];
  selected: string | null;
  onSelect: (deckId: string) => void;
}) {
  const [sort, setSort] = useState<keyof DeckSummary>("entries");

  const rows = [...decks].sort((a, b) => {
    const left = a[sort];
    const right = b[sort];
    if (typeof left === "number" && typeof right === "number") return right - left;
    if (left == null) return 1;
    if (right == null) return -1;
    return String(left).localeCompare(String(right));
  });

  return (
    <div className="table-scroll">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Deck</th>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="sortable"
                aria-sort={sort === column.key ? "descending" : "none"}
                onClick={() => setSort(column.key)}
              >
                {column.label}
                {sort === column.key ? " ↓" : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((deck) => (
            <tr key={deck.deck_id} aria-selected={deck.deck_id === selected}>
              <td>
                <div className="deck-cell">
                  <DeckIcon deckId={deck.deck_id} />
                  <button type="button" onClick={() => onSelect(deck.deck_id)}>
                    {deck.deck_name ?? deck.deck_id}
                  </button>
                </div>
              </td>
              {COLUMNS.map((column) => (
                <td key={column.key} className={column.className}>
                  {column.render(deck)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
