import { memo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { DeckSummary } from "../api";
import { useI18n } from "../i18n";
import { useFlip } from "../fx/useFlip";
import { DeckIcon } from "./DeckIcon";

type Ctx = { maxShare: number };

type Column = {
  key: keyof DeckSummary;
  label: string;
  render: (deck: DeckSummary, ctx: Ctx) => ReactNode;
  className?: string;
};

function columns({ t, count, percentSign, record }: ReturnType<typeof useI18n>): Column[] {
  return [
    {
      key: "meta_share",
      label: t("metaShare"),
      className: "with-bar",
      render: (d, { maxShare }) => (
        <span className="bar-cell">
          <span className="share-track" aria-hidden="true">
            <span style={{ width: `${((d.meta_share ?? 0) / maxShare) * 100}%` }} />
          </span>
          {percentSign(d.meta_share, 2)}
        </span>
      ),
    },
    { key: "entries", label: t("entries"), render: (d) => count(d.entries) },
    { key: "tournaments", label: t("events"), render: (d) => count(d.tournaments) },
    { key: "matches", label: t("matchesTitle"), render: (d) => count(d.matches) },
    { key: "wins", label: t("record"), render: (d) => record(d.wins, d.losses, d.ties) },
    // No bar here: deck-level rates sit within a few points of 50%, and on the
    // matrix's 25-75% domain that is a sliver. The matchup table draws one.
    {
      key: "score_rate",
      label: t("scoreRate"),
      render: (d) => <strong>{percentSign(d.score_rate)}</strong>,
    },
    {
      key: "score_low",
      label: t("range"),
      className: "muted",
      render: (d) => `${percentSign(d.score_low, 0)}–${percentSign(d.score_high, 0)}`,
    },
    { key: "win_rate", label: t("excludingTies"), className: "secondary", render: (d) => percentSign(d.win_rate) },
    {
      key: "champions",
      label: t("wins"),
      render: (d) =>
        d.champions > 0 ? (
          <span className="trophy">
            <TrophyIcon />
            {count(d.champions)}
          </span>
        ) : (
          <span className="muted">0</span>
        ),
    },
    { key: "top8", label: t("top8"), render: (d) => count(d.top8) },
  ];
}

/**
 * The deck list. Sortable because the two orderings people want — most played
 * and best performing — are genuinely different questions, and a deck that is
 * high on one and low on the other is the interesting case.
 *
 * Re-sorting animates: each row glides to its new place (useFlip), so the
 * reader can watch a deck climb or fall rather than hunt for it afterwards.
 */
export const DeckTable = memo(function DeckTable({
  decks,
  selected,
  onSelect,
}: {
  decks: DeckSummary[];
  selected: string | null;
  onSelect: (deckId: string) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const COLUMNS = columns(i18n);
  const [sort, setSort] = useState<keyof DeckSummary>("entries");
  const body = useRef<HTMLTableSectionElement>(null);

  const rows = [...decks].sort((a, b) => {
    const left = a[sort];
    const right = b[sort];
    if (typeof left === "number" && typeof right === "number") return right - left;
    if (left == null) return 1;
    if (right == null) return -1;
    return String(left).localeCompare(String(right));
  });

  useFlip(body, rows.map((deck) => deck.deck_id).join(" "));

  const ctx: Ctx = { maxShare: Math.max(...decks.map((d) => d.meta_share ?? 0), 0.0001) };

  return (
    <div className="table-scroll">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">{t("deck")}</th>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`sortable${sort === column.key ? " is-sorted" : ""}`}
                aria-sort={sort === column.key ? "descending" : "none"}
              >
                <button type="button" onClick={() => setSort(column.key)}>
                  {column.label}
                  <span className="sort-caret" aria-hidden="true">
                    ↓
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={body}>
          {rows.map((deck, i) => (
            <tr
              key={deck.deck_id}
              data-flip={deck.deck_id}
              aria-selected={deck.deck_id === selected}
              style={{ "--i": Math.min(i, 24) } as CSSProperties}
            >
              <td>
                <div className="deck-cell">
                  <span className={`rank-badge num${deck.rank <= 3 ? ` podium-${deck.rank}` : ""}`}>
                    {deck.rank}
                  </span>
                  <DeckIcon deckId={deck.deck_id} />
                  <button type="button" onClick={() => onSelect(deck.deck_id)}>
                    {deck.deck_name ?? deck.deck_id}
                  </button>
                </div>
              </td>
              {COLUMNS.map((column) => (
                <td key={column.key} className={column.className}>
                  {column.render(deck, ctx)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

const TrophyIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <path
      d="M4 2h8v3a4 4 0 0 1-8 0V2Zm-2.5 1H4v2a2 2 0 0 1-2.5-2ZM12 3h2.5A2 2 0 0 1 12 5V3ZM7 9.5h2V12h2v2H5v-2h2V9.5Z"
      fill="currentColor"
    />
  </svg>
);
