import type { CSSProperties, PointerEvent, ReactNode } from "react";
import type { DeckSummary, MatchupCell } from "../api";
import { count, percentSign, spansEven } from "../format";
import { reducedMotion, useCountUp } from "../fx/motion";
import { DeckIcon } from "./DeckIcon";

/**
 * Three headline numbers. Each is one figure, so it is a stat tile and not a
 * one-bar bar chart.
 *
 * "Best performing" and "most lopsided" both ignore anything whose interval
 * still spans 50%, because otherwise both would be won every time by whichever
 * deck happened to go 3-0 somewhere.
 *
 * Drawn as holo cards - they tilt toward the cursor and a foil sheen slides
 * across them - because this is a card game, and the tiles are the first thing
 * on the page that is about the decks rather than the data.
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
      <HoloTile
        index={0}
        tone="violet"
        label="Most played"
        value={mostPlayed?.meta_share ?? null}
        sub={mostPlayed ? `${mostPlayed.deck_name} · ${count(mostPlayed.entries)} entries` : "—"}
        art={mostPlayed && <DeckIcon deckId={mostPlayed.deck_id} alt="" />}
      >
        <ShareBar decks={top} />
      </HoloTile>

      <HoloTile
        index={1}
        tone="amber"
        label="Best score rate"
        value={bestPerforming?.score_rate ?? null}
        sub={
          bestPerforming
            ? `${bestPerforming.deck_name} · ${count(bestPerforming.matches)} matches`
            : "no deck clears 50% conclusively"
        }
        art={bestPerforming && <DeckIcon deckId={bestPerforming.deck_id} alt="" />}
      >
        {bestPerforming && <IntervalBar rated={bestPerforming} />}
      </HoloTile>

      <HoloTile
        index={2}
        tone="fuchsia"
        label="Most lopsided matchup"
        value={mostLopsided?.score_rate ?? null}
        sub={
          mostLopsided
            ? `${name.get(mostLopsided.deck_a)} over ${name.get(mostLopsided.deck_b)} · ${count(
                mostLopsided.matches,
              )} matches`
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
      </HoloTile>
    </div>
  );
}

function HoloTile({
  index,
  tone,
  label,
  value,
  sub,
  art,
  children,
}: {
  index: number;
  tone: "violet" | "amber" | "fuchsia";
  label: string;
  value: number | null;
  sub: string;
  art: ReactNode;
  children?: ReactNode;
}) {
  // Rolled in tenths of a percent so the last digit settles, not just jumps.
  const shown = useCountUp(value == null ? 0 : value * 1000, 1400) / 1000;

  // Tilt is written straight to CSS variables: a re-render per pointer move
  // would be pure waste for something only the compositor needs to know.
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (reducedMotion() || event.pointerType === "touch") return;
    const card = event.currentTarget;
    const box = card.getBoundingClientRect();
    const px = (event.clientX - box.left) / box.width;
    const py = (event.clientY - box.top) / box.height;
    card.style.setProperty("--px", `${px * 100}%`);
    card.style.setProperty("--py", `${py * 100}%`);
    card.style.setProperty("--rx", `${(0.5 - py) * 14}deg`);
    card.style.setProperty("--ry", `${(px - 0.5) * 18}deg`);
    card.style.setProperty("--hyp", `${Math.min(Math.hypot(px - 0.5, py - 0.5) * 2, 1)}`);
    // The art drifts further than the card tilts, which reads as depth.
    card.style.setProperty("--dx", `${(px - 0.5) * 14}px`);
    card.style.setProperty("--dy", `${(py - 0.5) * 10}px`);
  };

  const onLeave = (event: PointerEvent<HTMLDivElement>) => {
    const card = event.currentTarget;
    for (const prop of ["--rx", "--ry", "--hyp"]) card.style.setProperty(prop, "0");
    for (const prop of ["--dx", "--dy"]) card.style.setProperty(prop, "0px");
    card.style.setProperty("--px", "50%");
    card.style.setProperty("--py", "50%");
  };

  return (
    <div
      className={`holo tone-${tone}`}
      style={{ "--i": index } as CSSProperties}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      <div className="holo-card">
        <div className="holo-body">
          <span className="tile-label">
            <span className="tile-gem" aria-hidden="true" />
            {label}
          </span>
          <span className="tile-value num">{value == null ? "—" : percentSign(shown)}</span>
          <span className="tile-sub">{sub}</span>
          {children && <div className="tile-glyph">{children}</div>}
        </div>
        {art && <div className="tile-art">{art}</div>}
        <span className="holo-foil" aria-hidden="true" />
        <span className="holo-glare" aria-hidden="true" />
      </div>
    </div>
  );
}

/** The top decks' slices of the field, the leader in foil. The track is the
    whole field, so the empty remainder is everyone else. */
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
