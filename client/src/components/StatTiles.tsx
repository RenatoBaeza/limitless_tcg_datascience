import type { CSSProperties, ReactNode } from "react";
import type { DeckSummary, MatchupCell } from "../api";
import { count, percentSign, spansEven } from "../format";
import { useCountUp } from "../fx/motion";
import { DeckIcon } from "./DeckIcon";

/**
 * Three headline numbers. Each is one figure, so it is a stat tile and not a
 * one-bar bar chart.
 *
 * "Best performing" and "most lopsided" both ignore anything whose interval
 * still spans 50%, because otherwise both would be won every time by whichever
 * deck happened to go 3-0 somewhere.
 *
 * Drawn as Pokémon cards, because this is a card game and the tiles are the
 * first thing on the page that is about the decks rather than the data. They
 * are printed cards, not toys: nothing tilts or shines under the cursor.
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

  const top = [...decks].sort((a, b) => b.entries - a.entries).slice(0, 6);

  return (
    <div className="tiles">
      <PokeCard
        index={0}
        type="grass"
        stage="Most played"
        name={mostPlayed?.deck_name ?? "—"}
        unit="share"
        value={mostPlayed?.meta_share ?? null}
        sub={mostPlayed ? `${count(mostPlayed.entries)} entries` : "—"}
        art={mostPlayed && <DeckIcon deckId={mostPlayed.deck_id} alt="" />}
      >
        <ShareBar decks={top} />
      </PokeCard>

      <PokeCard
        index={1}
        type="lightning"
        stage="Best score rate"
        name={bestPerforming?.deck_name ?? "—"}
        unit="score"
        value={bestPerforming?.score_rate ?? null}
        sub={bestPerforming ? `${count(bestPerforming.matches)} matches` : "no deck clears 50% conclusively"}
        art={bestPerforming && <DeckIcon deckId={bestPerforming.deck_id} alt="" />}
      >
        {bestPerforming && <IntervalBar rated={bestPerforming} />}
      </PokeCard>

      <PokeCard
        index={2}
        type="fighting"
        stage="Most lopsided matchup"
        name={mostLopsided ? name.get(mostLopsided.deck_a) ?? mostLopsided.deck_a : "—"}
        unit="score"
        value={mostLopsided?.score_rate ?? null}
        sub={
          mostLopsided
            ? `over ${name.get(mostLopsided.deck_b) ?? mostLopsided.deck_b} · ${count(mostLopsided.matches)} matches`
            : "—"
        }
        art={
          mostLopsided && (
            <span className="versus-art">
              <DeckIcon deckId={mostLopsided.deck_a} alt="" />
              <span className="versus-bolt" aria-hidden="true">
                <BoltIcon />
              </span>
              <DeckIcon deckId={mostLopsided.deck_b} alt="" />
            </span>
          )
        }
      >
        {mostLopsided && <IntervalBar rated={mostLopsided} />}
      </PokeCard>
    </div>
  );
}

type Energy = "grass" | "lightning" | "fighting";

/**
 * One headline number laid out as a Pokémon card: the stat's name where a
 * card puts its stage, the deck where it puts the Pokémon's name, the number
 * where it puts HP, then the art window and a one-line "attack" beneath.
 */
function PokeCard({
  index,
  type,
  stage,
  name,
  unit,
  value,
  sub,
  art,
  children,
}: {
  index: number;
  type: Energy;
  stage: string;
  name: string;
  unit: string;
  value: number | null;
  sub: string;
  art: ReactNode;
  children?: ReactNode;
}) {
  // Rolled in tenths of a percent so the last digit settles, not just jumps.
  const shown = useCountUp(value == null ? 0 : value * 1000, 1400) / 1000;

  return (
    <div className={`pcard type-${type}`} style={{ "--i": index } as CSSProperties}>
      <div className="pcard-face">
        <div className="pcard-top">
          <div className="pcard-title">
            <span className="pcard-stage">{stage}</span>
            <span className="pcard-name">{name}</span>
          </div>
          <div className="pcard-hp">
            <small>{unit}</small>
            <span className="pcard-value num">{value == null ? "—" : percentSign(shown)}</span>
            <EnergyIcon type={type} />
          </div>
        </div>
        <div className="pcard-art">{art}</div>
        <span className="pcard-sub">{sub}</span>
        {children && <div className="tile-glyph">{children}</div>}
      </div>
    </div>
  );
}

/** The card's energy symbol, so the three tiles read as three types. */
function EnergyIcon({ type }: { type: Energy }) {
  return (
    <span className="energy" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="12" height="12">
        {type === "grass" && <path d="M2.5 13.5C2.5 7 7 2.5 13.5 2.5c0 6.5-4.5 11-11 11Z" fill="currentColor" />}
        {type === "lightning" && <path d="M9.5 1 3 9h4l-1 6 6.5-8h-4z" fill="currentColor" />}
        {type === "fighting" && (
          <path
            d="M4 6.5a1.5 1.5 0 0 1 3 0V5a1.5 1.5 0 0 1 3 0v.5a1.5 1.5 0 0 1 3 0V10a4 4 0 0 1-4 4H7.5A3.5 3.5 0 0 1 4 10.5Zm0 2.5H2.5a1 1 0 0 1 0-2H4"
            fill="currentColor"
          />
        )}
      </svg>
    </span>
  );
}

/** The top decks' slices of the field, the leader in the card's colour. The
    track is the whole field, so the empty remainder is everyone else. */
function ShareBar({ decks }: { decks: DeckSummary[] }) {
  const total = decks.reduce((sum, deck) => sum + (deck.meta_share ?? 0), 0);
  return (
    <div
      className="share-bar"
      role="img"
      aria-label={`Top ${decks.length} decks take ${percentSign(total)} of the field`}
    >
      {decks.map((deck, i) => (
        <span
          key={deck.deck_id}
          className={i === 0 ? "lead" : undefined}
          title={`${deck.deck_name}: ${percentSign(deck.meta_share)}`}
          style={{ width: `${(deck.meta_share ?? 0) * 100}%`, "--i": i } as CSSProperties}
        />
      ))}
      <em>top {decks.length} · {percentSign(total, 0)}</em>
    </div>
  );
}

/** The rate and its 95% interval on the same 25-75% axis the matrix uses. */
function IntervalBar({ rated }: { rated: { score_rate: number | null; score_low: number | null; score_high: number | null } }) {
  const at = (v: number) => `${Math.max(0, Math.min(100, ((v - 0.25) / 0.5) * 100))}%`;
  const rate = rated.score_rate ?? 0.5;
  const low = rated.score_low ?? rate;
  const high = rated.score_high ?? rate;

  return (
    <div
      className="interval-bar"
      role="img"
      aria-label={`95% range ${percentSign(low, 0)} to ${percentSign(high, 0)}`}
    >
      <span className="even" style={{ left: "50%" }} />
      <span className="range" style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})` }} />
      <span className="point" style={{ left: at(rate) }} />
      <em style={{ left: "50%" }}>50</em>
    </div>
  );
}

const BoltIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14">
    <path d="M9.5 1 3 9h4l-1 6 6.5-8h-4z" fill="currentColor" />
  </svg>
);
