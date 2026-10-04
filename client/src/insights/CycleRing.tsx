import { useMemo, useState } from "react";
import type { Cycles } from "../analysis";
import { deckImage } from "../api";
import { useI18n } from "../i18n";
import { scoreColor, type Mode } from "../scale";

const W = 840;
const H = 580;
const CX = W / 2;
const CY = H / 2;
const R = 175;
const NODE = 30;
const LABEL_R = R + NODE + 12;

/** Math angle (degrees, counter-clockwise from east) to screen. y is flipped,
 * so counter-clockwise in the data is counter-clockwise on screen too. */
const at = (degrees: number, radius = R) => {
  const a = (degrees * Math.PI) / 180;
  return { x: CX + radius * Math.cos(a), y: CY - radius * Math.sin(a) };
};

/**
 * The cycle's largest rock-paper-scissors pattern, as a ring.
 *
 * The decks go round in the order the disc-game embedding gave them, and the
 * arrows run counter-clockwise from each deck to the next: a deck tends to beat
 * the decks ahead of it and lose to the ones behind. They are spaced evenly
 * rather than at their exact angles - the order is what carries the meaning,
 * and the embedding bunches several decks within a few degrees of each other,
 * which piles their sprites and names on top of one another. The positions are a model, so
 * focusing a deck swaps the model for the record - every other deck on the
 * ring is outlined and badged with the focused deck's actual score against it,
 * on the matrix's own blue/red scale. Only colour changes on hover; nothing
 * moves.
 */
export function CycleRing({
  cycles,
  names,
  mode,
}: {
  cycles: Cycles;
  names: Record<string, string>;
  mode: Mode;
}) {
  const { t, percentSign } = useI18n();
  const [active, setActive] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const focus = active ?? pinned;

  const pairs = useMemo(() => {
    const map = new Map<string, { rate: number; matches: number }>();
    for (const p of cycles.ring_pairs) map.set(`${p.a}|${p.b}`, p);
    return map;
  }, [cycles.ring_pairs]);

  // Evenly spaced, in order, starting where the embedding put the first deck.
  const ring = cycles.ring.map((node, i, all) => ({
    ...node,
    angle: all[0].angle + (i * 360) / all.length,
  }));
  const name = (id: string) => names[id] ?? id;
  const gap = ((NODE + 6) / R) * (180 / Math.PI);

  const arcs = ring.map((node, i) => {
    const next = ring[(i + 1) % ring.length];
    let span = next.angle - node.angle;
    if (span <= 0) span += 360;
    if (span <= 2 * gap + 2) return null;
    const from = at(node.angle + gap);
    const to = at(next.angle - gap);
    // Counter-clockwise on screen is sweep 0 with y pointing down.
    const large = span - 2 * gap > 180 ? 1 : 0;
    return <path key={node.deck_id} d={`M${from.x},${from.y} A${R},${R} 0 ${large} 0 ${to.x},${to.y}`} markerEnd="url(#ring-arrow)" />;
  });

  const results = focus
    ? ring
        .filter((node) => node.deck_id !== focus)
        .map((node) => ({ id: node.deck_id, ...pairs.get(`${focus}|${node.deck_id}`) }))
    : [];
  const beats = results.filter((r) => r.rate != null && r.rate > 0.5).sort((a, b) => b.rate! - a.rate!);
  const loses = results.filter((r) => r.rate != null && r.rate < 0.5).sort((a, b) => a.rate! - b.rate!);
  const list = (rows: typeof results) =>
    rows.map((r) => `${name(r.id)} ${percentSign(r.rate, 0)}`).join(", ") || "—";

  return (
    <div className="ring">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={`ring-svg${focus ? " has-focus" : ""}`}
        role="group"
        aria-label={t("ringTitle")}
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          <marker id="ring-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M1,1 L8,5 L1,9" className="ring-arrowhead" />
          </marker>
          <clipPath id="ring-node-clip">
            <circle r={NODE - 3} />
          </clipPath>
        </defs>

        <circle cx={CX} cy={CY} r={R} className="ring-track" />
        <g className="ring-arcs">{arcs}</g>

        {ring.map((node) => {
          const p = at(node.angle);
          const label = at(node.angle, LABEL_R);
          const cos = Math.cos((node.angle * Math.PI) / 180);
          const anchor = Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end";
          const sin = Math.sin((node.angle * Math.PI) / 180);
          const dy = sin > 0.3 ? -4 : sin < -0.3 ? 14 : 4;

          const isFocus = node.deck_id === focus;
          const result = focus && !isFocus ? pairs.get(`${focus}|${node.deck_id}`) : undefined;
          const color = result ? scoreColor(result.rate, mode) : null;
          const state = !focus ? "" : isFocus ? " is-focus" : result ? " has-result" : " is-unmet";
          const description = result
            ? t("matchupDescription", {
                name: `${name(focus!)} vs ${name(node.deck_id)}`,
                rate: percentSign(result.rate, 0),
                matches: t("matchCount", { count: result.matches }),
              })
            : name(node.deck_id);

          return (
            <g
              key={node.deck_id}
              className={`ring-node${state}`}
              transform={`translate(${p.x},${p.y})`}
              tabIndex={0}
              role="button"
              aria-pressed={pinned === node.deck_id}
              aria-label={description}
              onPointerEnter={() => setActive(node.deck_id)}
              onFocus={() => setActive(node.deck_id)}
              onBlur={() => setActive(null)}
              onClick={() => setPinned((current) => (current === node.deck_id ? null : node.deck_id))}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setPinned((current) => (current === node.deck_id ? null : node.deck_id));
                }
              }}
            >
              <circle r={NODE} className="ring-disc" style={color ? { stroke: color.edge } : undefined} />
              <image
                href={deckImage(node.deck_id)}
                x={-NODE + 4}
                y={-NODE + 4}
                width={2 * NODE - 8}
                height={2 * NODE - 8}
                preserveAspectRatio="xMidYMid meet"
                clipPath="url(#ring-node-clip)"
              />
              {result && color && (
                <g transform={`translate(0,${NODE + 2})`} className="ring-badge">
                  <rect x={-21} y={-10} width={42} height={20} rx={6} style={{ fill: color.background, stroke: color.edge }} />
                  <text y={4.5} textAnchor="middle" style={{ fill: color.ink }}>
                    {percentSign(result.rate, 0)}
                  </text>
                </g>
              )}
              <text
                className="ring-label"
                x={label.x - p.x}
                y={label.y - p.y + dy}
                textAnchor={anchor}
              >
                {name(node.deck_id)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* On a phone the ring's own labels are too small to read, so the
          order is written out instead; hidden from wider layouts by CSS. */}
      <ol className="ring-order" aria-label={t("ringOrder")}>
        {ring.map((node) => (
          <li key={node.deck_id}>
            <img src={deckImage(node.deck_id)} alt="" />
            {name(node.deck_id)}
          </li>
        ))}
      </ol>

      <p className="ring-readout" aria-live="polite">
        {focus ? (
          <>
            <strong>{name(focus)}</strong> · {t("ringBeats")}: {list(beats)} · {t("ringLoses")}: {list(loses)}
          </>
        ) : (
          <span className="muted">
            {t("ringHint", { count: ring.length - 1 })}
          </span>
        )}
      </p>
    </div>
  );
}
