import type { CSSProperties } from "react";
import type { DeckSummary, MatchupCell } from "../api";
import { useI18n } from "../i18n";
import { scoreColor, type Mode } from "../scale";
import { DeckIcon } from "./DeckIcon";

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
  mode,
}: {
  decks: DeckSummary[];
  cells: MatchupCell[];
  onSelect: (deckId: string) => void;
  mode: Mode;
}) {
  const { t, count, percentSign, record } = useI18n();
  const name = new Map(decks.map((deck) => [deck.deck_id, deck.deck_name ?? deck.deck_id]));
  const rows = [...cells].sort((a, b) => b.matches - a.matches);

  if (!rows.length) {
    return <p className="notice">{t("noMatchups")}</p>;
  }

  return (
    <div className="table-scroll">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">{t("deck")}</th>
            <th scope="col" style={{ textAlign: "left" }}>
              {t("opponent")}
            </th>
            <th scope="col">{t("matchesTitle")}</th>
            <th scope="col">{t("record")}</th>
            <th scope="col">{t("scoreRate")}</th>
            <th scope="col">{t("range")}</th>
            <th scope="col">{t("excludingTies")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((cell, i) => (
            <tr key={`${cell.deck_a} ${cell.deck_b}`} style={{ "--i": Math.min(i, 24) } as CSSProperties}>
              <td>
                <div className="deck-cell">
                  <DeckIcon deckId={cell.deck_a} />
                  <button type="button" onClick={() => onSelect(cell.deck_a)}>
                    {name.get(cell.deck_a) ?? cell.deck_a}
                  </button>
                </div>
              </td>
              <td style={{ textAlign: "left" }} className="secondary">
                <div className="deck-cell">
                  <DeckIcon deckId={cell.deck_b} />
                  {name.get(cell.deck_b) ?? cell.deck_b}
                </div>
              </td>
              <td>{count(cell.matches)}</td>
              <td>{record(cell.wins, cell.losses, cell.ties)}</td>
              <td className="with-bar">
                <ScoreBar rate={cell.score_rate} mode={mode} />
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

/**
 * A rate as a bar growing out of 50% - right and blue above even, left and red
 * below - on the matrix's 25-75% domain and in the matrix's own colours.
 */
function ScoreBar({ rate, mode }: { rate: number | null; mode: Mode }) {
  const { percentSign } = useI18n();
  if (rate == null) return <>—</>;
  const offset = Math.max(-1, Math.min(1, (rate - 0.5) / 0.25)) * 50;
  const { background } = scoreColor(rate, mode);

  return (
    <span className="bar-cell">
      <span className="score-track" aria-hidden="true">
        <span
          style={{
            left: offset >= 0 ? "50%" : `${50 + offset}%`,
            width: `${Math.abs(offset)}%`,
            background,
            transformOrigin: offset >= 0 ? "0 50%" : "100% 50%",
          }}
        />
      </span>
      <strong>{percentSign(rate)}</strong>
    </span>
  );
}
