import type { CSSProperties, ReactNode } from "react";
import type { DeckSummary, MatchupCell } from "../api";
import { spansEven } from "../format";
import { useI18n } from "../i18n";
import { useCountUp } from "../fx/motion";
import { DeckIcon } from "./DeckIcon";

/**
 * Three headline numbers. Each is one figure, so it is a stat tile and not a
 * one-bar bar chart.
 *
 * "Best performing" and "most lopsided" both ignore anything too thin to call
 * (its Wilson interval still spans 50%), because otherwise both would be won every time by whichever
 * deck happened to go 3-0 somewhere.
 *
 * Drawn as Pokémon cards, because this is a card game and the tiles are the
 * first thing on the page that is about the decks rather than the data. They
 * are printed cards, not toys: nothing tilts or shines under the cursor.
 */
export function StatTiles({ decks, cells }: { decks: DeckSummary[]; cells: MatchupCell[] }) {
  const { t } = useI18n();
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
        stage={t("mostPlayed")}
        name={mostPlayed?.deck_name ?? "—"}
        unit={t("share")}
        value={mostPlayed?.meta_share ?? null}
        sub={mostPlayed ? t("entryCount", { count: mostPlayed.entries }) : "—"}
        art={mostPlayed && <DeckIcon deckId={mostPlayed.deck_id} alt="" />}
      >
        <ShareBar decks={top} />
      </PokeCard>

      <PokeCard
        index={1}
        stage={t("bestScore")}
        name={bestPerforming?.deck_name ?? "—"}
        unit={t("score")}
        value={bestPerforming?.score_rate ?? null}
        sub={bestPerforming ? t("matchCount", { count: bestPerforming.matches }) : t("inconclusiveDecks")}
        art={bestPerforming && <DeckIcon deckId={bestPerforming.deck_id} alt="" />}
      >
        {bestPerforming && <RateBar rate={bestPerforming.score_rate} />}
      </PokeCard>

      <PokeCard
        index={2}
        stage={t("lopsided")}
        name={mostLopsided ? name.get(mostLopsided.deck_a) ?? mostLopsided.deck_a : "—"}
        unit={t("score")}
        value={mostLopsided?.score_rate ?? null}
        sub={
          mostLopsided
            ? t("overOpponent", { opponent: name.get(mostLopsided.deck_b) ?? mostLopsided.deck_b, matches: t("matchCount", { count: mostLopsided.matches }) })
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
        {mostLopsided && <RateBar rate={mostLopsided.score_rate} />}
      </PokeCard>
    </div>
  );
}

/**
 * One headline number laid out as a Pokémon card: the stat's name where a
 * card puts its stage, the deck where it puts the Pokémon's name, the number
 * where it puts HP, then the art window and a one-line "attack" beneath.
 */
function PokeCard({
  index,
  stage,
  name,
  unit,
  value,
  sub,
  art,
  children,
}: {
  index: number;
  stage: string;
  name: string;
  unit: string;
  value: number | null;
  sub: string;
  art: ReactNode;
  children?: ReactNode;
}) {
  const { percentSign } = useI18n();
  // Rolled in tenths of a percent so the last digit settles, not just jumps.
  const shown = useCountUp(value == null ? 0 : value * 1000, 1400) / 1000;

  return (
    <div className="pcard" style={{ "--i": index } as CSSProperties}>
      <div className="pcard-face">
        <div className="pcard-top">
          <div className="pcard-title">
            <span className="pcard-stage">{stage}</span>
            <span className="pcard-name">{name}</span>
          </div>
          <div className="pcard-hp">
            <small>{unit}</small>
            <span className="pcard-value num">{value == null ? "—" : percentSign(shown)}</span>
          </div>
        </div>
        <div className="pcard-art">{art}</div>
        <span className="pcard-sub">{sub}</span>
        {children && <div className="tile-glyph">{children}</div>}
      </div>
    </div>
  );
}

/** The top decks' slices of the field, the leader in the card's colour. The
    track is the whole field, so the empty remainder is everyone else. */
function ShareBar({ decks }: { decks: DeckSummary[] }) {
  const { t, percentSign } = useI18n();
  const total = decks.reduce((sum, deck) => sum + (deck.meta_share ?? 0), 0);
  return (
    <div
      className="share-bar"
      role="img"
      aria-label={t("topShare", { count: decks.length, share: percentSign(total) })}
    >
      {decks.map((deck, i) => (
        <span
          key={deck.deck_id}
          className={i === 0 ? "lead" : undefined}
          title={`${deck.deck_name}: ${percentSign(deck.meta_share)}`}
          style={{ width: `${(deck.meta_share ?? 0) * 100}%`, "--i": i } as CSSProperties}
        />
      ))}
      <em>{t("top", { count: decks.length })} · {percentSign(total, 0)}</em>
    </div>
  );
}

/** The rate against even, on the same 25-75% axis the matrix uses. */
function RateBar({ rate }: { rate: number | null }) {
  const at = (v: number) => `${Math.max(0, Math.min(100, ((v - 0.25) / 0.5) * 100))}%`;

  return (
    <div className="rate-bar" aria-hidden="true">
      <span className="even" style={{ left: "50%" }} />
      <span className="point" style={{ left: at(rate ?? 0.5) }} />
      <em style={{ left: "50%" }}>50</em>
    </div>
  );
}

const BoltIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14">
    <path d="M9.5 1 3 9h4l-1 6 6.5-8h-4z" fill="currentColor" />
  </svg>
);
