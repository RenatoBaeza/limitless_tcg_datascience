import { useState, type CSSProperties } from "react";
import type { Cycles } from "../analysis";
import { DeckIcon } from "../components/DeckIcon";
import { useI18n } from "../i18n";
import { scoreColor, type Mode } from "../scale";

/** Strengths span a few points either side of even; this is the bar's half-width. */
const SPAN = 0.08;
const SHOWN = 15;

/**
 * The transitive part on its own: each deck's expected score against a deck
 * of average strength, matchups set aside.
 *
 * A rate either side of even is a polarity, so the bars diverge from a 50%
 * centre line in the matrix's two poles, blue above and red below. Only the
 * pole is borrowed, not the ramp: strengths span a few points where matchups
 * span twenty-five, so on the matrix's ramp every bar would sit at its
 * near-neutral end. Length carries the size, and the number beside each bar
 * means the colour never carries the value alone.
 */
export function StrengthLadder({
  cycles,
  names,
  mode,
}: {
  cycles: Cycles;
  names: Record<string, string>;
  mode: Mode;
}) {
  const { t, percentSign, count } = useI18n();
  const [all, setAll] = useState(false);
  const rows = all ? cycles.ladder : cycles.ladder.slice(0, SHOWN);

  return (
    <div className="ladder">
      <ol className="ladder-list">
        {rows.map((row, i) => {
          const offset = Math.max(-1, Math.min(1, (row.strength - 0.5) / SPAN));
          const color = scoreColor(row.strength >= 0.5 ? 0.72 : 0.28, mode);
          const name = names[row.deck_id] ?? row.deck_id;
          return (
            <li
              key={row.deck_id}
              className="ladder-row"
              title={`${name}: ${percentSign(row.strength)} · ${t("matchCount", { count: row.matches })}`}
            >
              <span className="ladder-rank num">{i + 1}</span>
              <span className="ladder-deck">
                <DeckIcon deckId={row.deck_id} />
                <span>{name}</span>
              </span>
              <span className="ladder-track" aria-hidden="true">
                <span
                  className="ladder-bar"
                  style={
                    {
                      "--from": `${50 + Math.min(0, offset) * 50}%`,
                      "--width": `${Math.abs(offset) * 50}%`,
                      "--c": color.edge,
                      "--i": i,
                    } as CSSProperties
                  }
                />
              </span>
              <span className="ladder-value num">{percentSign(row.strength)}</span>
            </li>
          );
        })}
      </ol>

      <div className="ladder-foot">
        <span className="ladder-axis muted" aria-hidden="true">
          <span className="num">{percentSign(0.5 - SPAN, 0)}</span>
          <span className="num">50%</span>
          <span className="num">{percentSign(0.5 + SPAN, 0)}</span>
        </span>
        {cycles.ladder.length > SHOWN && (
          <button type="button" className="link-button" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? t("showFewer") : t("showAll", { count: count(cycles.ladder.length) })}
          </button>
        )}
      </div>
    </div>
  );
}
