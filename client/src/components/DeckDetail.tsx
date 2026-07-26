import { useQuery } from "@tanstack/react-query";
import type { DeckMatchup, DeckSummary, Window } from "../api";
import { fetchDeckMatchups } from "../api";
import { count, percentSign, record, spansEven } from "../format";
import { DeckIcon } from "./DeckIcon";

// The dot plot spans this range, matching the matrix scale so the two views
// are read on the same footing.
const AXIS_LOW = 0.25;
const AXIS_HIGH = 0.75;
const TICKS = [0.3, 0.4, 0.5, 0.6, 0.7];

/**
 * One deck against the whole field.
 *
 * A dot plot with whiskers rather than bars: the value is a rate, not a
 * magnitude, so there is no meaningful zero for a bar to grow from — and the
 * whisker is the point. It shows at a glance which matchups are known and
 * which are three games and a shrug.
 */
export function DeckDetail({
  deck,
  window: dateWindow,
  minMatches,
  includeOther,
  onClose,
}: {
  deck: DeckSummary;
  window: Window;
  minMatches: number;
  includeOther: boolean;
  onClose: () => void;
}) {
  const { data, isPending, isError, error, isPlaceholderData } = useQuery({
    queryKey: ["deck-matchups", deck.deck_id, dateWindow, minMatches, includeOther],
    queryFn: () => fetchDeckMatchups(deck.deck_id, dateWindow, minMatches, includeOther),
    placeholderData: (previous) => previous,
  });

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="detail-head">
          <DeckIcon deckId={deck.deck_id} alt="" />
          <div>
            <h2>{deck.deck_name ?? deck.deck_id} vs. the field</h2>
            <div className="panel-note">
              {percentSign(deck.score_rate)} overall over {count(deck.matches)} matches ·{" "}
              {record(deck.wins, deck.losses, deck.ties)} · {percentSign(deck.meta_share, 2)} of the
              field
            </div>
          </div>
        </div>
        <button type="button" className="close" onClick={onClose}>
          Close
        </button>
      </div>

      {isError && <p className="error">{(error as Error).message}</p>}
      {isPending && <p className="notice">Loading matchups…</p>}

      {data && (
        <div className={isPlaceholderData ? "stale" : undefined}>
          <div className="dots">
            {data.map((matchup) => (
              <DotRow key={matchup.deck_b} matchup={matchup} />
            ))}
          </div>

          <div className="dot-axis">
            <span />
            <div className="ticks">
              {TICKS.map((tick) => (
                <span key={tick} style={{ left: `${position(tick)}%` }}>
                  {Math.round(tick * 100)}%
                </span>
              ))}
            </div>
            <span />
          </div>

          {!data.length && (
            <p className="notice">
              No opponent reached {minMatches} matches in this window. Lower the minimum or widen
              the range.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function DotRow({ matchup }: { matchup: DeckMatchup }) {
  const rate = matchup.score_rate ?? 0.5;
  const low = matchup.score_low ?? rate;
  const high = matchup.score_high ?? rate;
  const inconclusive = spansEven(matchup.score_low, matchup.score_high);

  const label = `${matchup.deck_name ?? matchup.deck_b}: ${percentSign(rate)} over ${
    matchup.matches
  } matches, 95% range ${percentSign(low, 0)} to ${percentSign(high, 0)}`;

  return (
    <div className="dot-row" title={label}>
      <div className="dot-label">
        <DeckIcon deckId={matchup.deck_b} />
        <span>{matchup.deck_name ?? matchup.deck_b}</span>
      </div>

      <div className="dot-track" role="img" aria-label={label}>
        {TICKS.map((tick) => (
          <div
            key={tick}
            className={`gridline${tick === 0.5 ? " even" : ""}`}
            style={{ left: `${position(tick)}%` }}
          />
        ))}
        <div
          className="whisker"
          style={{ left: `${position(low)}%`, width: `${position(high) - position(low)}%` }}
        />
        <div className="dot" style={{ left: `${position(rate)}%` }} />
      </div>

      <div className="dot-value">
        <strong className={inconclusive ? "muted" : undefined}>{percentSign(rate)}</strong>{" "}
        <span className="muted">
          {record(matchup.wins, matchup.losses, matchup.ties)} · {count(matchup.matches)}
        </span>
      </div>
    </div>
  );
}

const position = (value: number) =>
  Math.max(0, Math.min(100, ((value - AXIS_LOW) / (AXIS_HIGH - AXIS_LOW)) * 100));
