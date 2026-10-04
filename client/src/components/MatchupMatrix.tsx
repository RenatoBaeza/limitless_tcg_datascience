import { memo, useCallback, useMemo, useState, type CSSProperties, type FocusEvent, type PointerEvent } from "react";
import type { DeckSummary, MatchupCell } from "../api";
import { count, percent, percentSign, record, spansEven } from "../format";
import { useVersion } from "../fx/motion";
import type { Mode } from "../scale";
import { scoreColor } from "../scale";
import { DeckIcon } from "./DeckIcon";
import { ScaleLegend } from "./ScaleLegend";
import { IntervalReadout, Tooltip, type Anchor } from "./Tooltip";

/**
 * The matchup grid. A row is a deck, a column is its opponent, and the cell is
 * that row deck's score rate against that column deck.
 *
 * Three kinds of cell, and the difference between them matters:
 *
 *   painted   they met at least `minMatches` times. The fill is the rate on a
 *             diverging scale and the number is the same rate, so the value is
 *             never carried by colour alone.
 *   mirror    the diagonal. A deck against itself is 50% by construction, so
 *             the gold layer does not store it and the cell shows the deck's
 *             own sprite rather than a number that would look like a finding.
 *   empty     they never met, or not often enough. A dot rather than 0%,
 *             which is a different claim entirely.
 *
 * Cells whose confidence interval still spans 50% are drawn muted: the colour
 * pulled most of the way back to the board, the full-strength colour kept as a
 * thin outline. The point estimate is there, but the data cannot yet call the
 * matchup either way, so it should not shout as loud as one it can.
 *
 * Hovering a cell lights its row and column and dims the rest, so the reader
 * can follow one deck across and its opponent down. That crosshair is a two-
 * selector <style> rule written from the hovered indices, not a prop: the grid
 * itself is memoised and never re-renders on hover, which is what keeps a
 * 40 x 40 matrix smooth.
 */
export function MatchupMatrix({
  decks,
  cells,
  mode,
  minMatches,
  onSelect,
}: {
  decks: DeckSummary[];
  cells: MatchupCell[];
  mode: Mode;
  minMatches: number;
  onSelect: (deckId: string) => void;
}) {
  const [hovered, setHovered] = useState<{ r: number; c: number; cell: MatchupCell | null; anchor: Anchor } | null>(
    null,
  );

  // Replays the entrance wave when a new result lands.
  const version = useVersion(cells);

  // The parent re-renders on every pointer move (the tooltip follows it), so
  // the lookups are built once per result, not once per move.
  const name = useMemo(() => new Map(decks.map((deck) => [deck.deck_id, deck.deck_name ?? deck.deck_id])), [decks]);
  const byPair = useMemo(() => new Map(cells.map((cell) => [`${cell.deck_a} ${cell.deck_b}`, cell])), [cells]);

  const onHover = useCallback(
    (r: number, c: number, anchor: Anchor) => {
      const row = decks[r];
      const column = decks[c];
      const cell = row && column ? byPair.get(`${row.deck_id} ${column.deck_id}`) ?? null : null;
      setHovered({ r, c, cell, anchor });
    },
    [decks, byPair],
  );
  const onLeave = useCallback(() => setHovered(null), []);

  if (!decks.length) {
    return <p className="notice">No decks in this window.</p>;
  }

  return (
    <>
      <ScaleLegend mode={mode} marker={hovered?.cell?.score_rate ?? null} />

      {hovered && (
        <style>{`
          .matrix-scroll td.cell:not([data-r="${hovered.r}"]):not([data-c="${hovered.c}"]) > * { opacity: 0.22; filter: saturate(0.4); }
          .matrix-scroll th[data-c="${hovered.c}"], .matrix-scroll th[data-r="${hovered.r}"] { --lit: 1; }
        `}</style>
      )}

      <div className="matrix-scroll">
        <MatrixGrid
          key={version}
          decks={decks}
          cells={cells}
          mode={mode}
          minMatches={minMatches}
          onHover={onHover}
          onLeave={onLeave}
          onSelect={onSelect}
        />
      </div>

      {hovered?.cell && (
        <Tooltip anchor={hovered.anchor}>
          <CellReadout cell={hovered.cell} names={name} mode={mode} />
        </Tooltip>
      )}
    </>
  );
}

const MatrixGrid = memo(function MatrixGrid({
  decks,
  cells,
  mode,
  minMatches,
  onHover,
  onLeave,
  onSelect,
}: {
  decks: DeckSummary[];
  cells: MatchupCell[];
  mode: Mode;
  minMatches: number;
  onHover: (r: number, c: number, anchor: Anchor) => void;
  onLeave: () => void;
  onSelect: (deckId: string) => void;
}) {
  const byPair = new Map(cells.map((cell) => [`${cell.deck_a} ${cell.deck_b}`, cell]));
  const name = (deck: DeckSummary) => deck.deck_name ?? deck.deck_id;

  // One delegated listener for the whole grid rather than four per cell.
  const locate = (target: EventTarget) => {
    const td = (target as HTMLElement).closest<HTMLElement>("td.cell");
    if (!td) return null;
    return { r: Number(td.dataset.r), c: Number(td.dataset.c), td };
  };

  const onPointerMove = (event: PointerEvent<HTMLTableElement>) => {
    const hit = locate(event.target);
    if (hit) onHover(hit.r, hit.c, { x: event.clientX, y: event.clientY });
    else onLeave();
  };

  const onFocus = (event: FocusEvent<HTMLTableElement>) => {
    const hit = locate(event.target);
    if (!hit) return;
    const box = hit.td.getBoundingClientRect();
    onHover(hit.r, hit.c, { x: box.right, y: box.bottom });
  };

  return (
    <table
      className="matrix"
      style={{ "--n": decks.length } as CSSProperties}
      onPointerMove={onPointerMove}
      onPointerLeave={onLeave}
      onFocus={onFocus}
      onBlur={onLeave}
    >
      <caption className="sr-only">Score rate of each deck (rows) against each opponent (columns).</caption>
      <thead>
        <tr>
          <th className="corner" scope="col">
            <span>Deck</span>
            <span className="corner-arrow">vs. →</span>
          </th>
          {decks.map((deck, c) => (
            <th
              key={deck.deck_id}
              scope="col"
              className="col-head"
              data-c={c}
              title={name(deck)}
              style={{ "--d": c } as CSSProperties}
            >
              <DeckIcon deckId={deck.deck_id} alt={name(deck)} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {decks.map((row, r) => (
          <tr key={row.deck_id}>
            <th scope="row" className="row-head" data-r={r} style={{ "--d": r } as CSSProperties}>
              <button type="button" onClick={() => onSelect(row.deck_id)}>
                <span className="rank num">{row.rank}</span>
                <DeckIcon deckId={row.deck_id} />
                <span className="name">{name(row)}</span>
              </button>
            </th>

            {decks.map((column, c) => {
              const wave = { "--d": r + c } as CSSProperties;

              if (row.deck_id === column.deck_id) {
                return (
                  <td key={column.deck_id} className="cell mirror" data-r={r} data-c={c}>
                    <div title={`${name(row)} mirror — 50% by definition`} style={wave}>
                      <DeckIcon deckId={row.deck_id} />
                    </div>
                  </td>
                );
              }

              const cell = byPair.get(`${row.deck_id} ${column.deck_id}`);
              if (!cell || cell.score_rate == null) {
                return (
                  <td key={column.deck_id} className="cell empty" data-r={r} data-c={c}>
                    <div
                      style={wave}
                      title={`No ${name(row)} vs ${name(column)} data (under ${minMatches} matches)`}
                    />
                  </td>
                );
              }

              const inconclusive = spansEven(cell.score_low, cell.score_high);
              const { background, ink, edge } = scoreColor(cell.score_rate, mode, inconclusive);

              return (
                <td key={column.deck_id} className="cell" data-r={r} data-c={c}>
                  <button
                    type="button"
                    className={inconclusive ? "muted" : undefined}
                    style={{ ...wave, backgroundColor: background, color: ink, "--edge": edge } as CSSProperties}
                    aria-label={`${name(row)} vs ${name(column)}: ${percentSign(cell.score_rate)} over ${
                      cell.matches
                    } matches${inconclusive ? ", range still spans 50%" : ""}`}
                    onClick={() => onSelect(row.deck_id)}
                  >
                    {percent(cell.score_rate)}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
});

/** Value leads, labels follow — the reader already knows which cell they are on. */
function CellReadout({ cell, names, mode }: { cell: MatchupCell; names: Map<string, string>; mode: Mode }) {
  const { background } = scoreColor(cell.score_rate ?? 0.5, mode);

  return (
    <>
      <div className="tip-matchup">
        <DeckIcon deckId={cell.deck_a} />
        <span className="tip-vs">vs</span>
        <DeckIcon deckId={cell.deck_b} />
      </div>
      <div className="headline" style={{ "--c": background } as CSSProperties}>
        {percentSign(cell.score_rate)}
      </div>
      <div className="who">
        {names.get(cell.deck_a) ?? cell.deck_a} <span className="muted">vs</span>{" "}
        {names.get(cell.deck_b) ?? cell.deck_b}
      </div>
      <IntervalReadout rate={cell.score_rate} low={cell.score_low} high={cell.score_high} color={background} />
      <dl>
        <dt>Record</dt>
        <dd>{record(cell.wins, cell.losses, cell.ties)}</dd>
        <dt>Matches</dt>
        <dd>{count(cell.matches)}</dd>
        <dt>Excl. ties</dt>
        <dd>{percentSign(cell.win_rate)}</dd>
        <dt>95% range</dt>
        <dd>
          {percentSign(cell.score_low, 0)}–{percentSign(cell.score_high, 0)}
        </dd>
      </dl>
    </>
  );
}
