import type { CSSProperties } from "react";
import type { Cycles } from "../analysis";
import { deckImage } from "../api";
import { useI18n } from "../i18n";

// Vertices of the drawn triangle, clockwise from the top, so A -> B -> C -> A
// runs clockwise on screen.
const VERTS = [
  { x: 130, y: 44 },
  { x: 226, y: 196 },
  { x: 34, y: 196 },
];
const NODE = 27;

/**
 * Every three-deck rock-paper-scissors the data is sure of: each deck beats
 * the next with the edge clearly above even. Drawn as a type chart - three
 * Pokémon, three arrows, the score on each arrow - with the same three
 * results written out beneath for anyone who would rather read than look.
 */
export function Triangles({ cycles, names }: { cycles: Cycles; names: Record<string, string> }) {
  const { t, percentSign } = useI18n();
  const name = (id: string) => names[id] ?? id;

  if (!cycles.triangles.length) return <p className="muted">{t("noTriangles")}</p>;

  return (
    <ol className="triangles">
      {cycles.triangles.map((tri, n) => (
        <li key={tri.decks.join("|")} className="triangle-card" style={{ "--i": n } as CSSProperties}>
          <svg viewBox="0 0 260 236" className="triangle-svg" aria-hidden="true">
            <defs>
              <marker id={`tri-arrow-${n}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M1,1 L8,5 L1,9" className="ring-arrowhead" />
              </marker>
            </defs>
            {VERTS.map((from, k) => {
              const to = VERTS[(k + 1) % 3];
              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const len = Math.hypot(dx, dy);
              const ux = dx / len;
              const uy = dy / len;
              const start = { x: from.x + ux * (NODE + 6), y: from.y + uy * (NODE + 6) };
              const end = { x: to.x - ux * (NODE + 8), y: to.y - uy * (NODE + 8) };
              // The label sits outside the triangle, off the edge's midpoint.
              const mid = { x: (from.x + to.x) / 2 + uy * 16, y: (from.y + to.y) / 2 - ux * 16 };
              return (
                <g key={k}>
                  <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} className="triangle-edge" markerEnd={`url(#tri-arrow-${n})`} />
                  <text x={mid.x} y={mid.y + 4} textAnchor="middle" className="triangle-rate">
                    {percentSign(tri.rates[k], 0)}
                  </text>
                </g>
              );
            })}
            {VERTS.map((v, k) => (
              <g key={tri.decks[k]} transform={`translate(${v.x},${v.y})`}>
                <circle r={NODE} className="ring-disc" />
                <image href={deckImage(tri.decks[k])} x={-NODE + 4} y={-NODE + 4} width={2 * NODE - 8} height={2 * NODE - 8} />
              </g>
            ))}
          </svg>
          <ul className="triangle-lines">
            {tri.decks.map((id, k) => {
              const loser = tri.decks[(k + 1) % 3];
              return (
                <li key={id}>
                  {t("beatsLine", { winner: name(id), loser: name(loser) })}{" "}
                  <strong className="num">{percentSign(tri.rates[k], 0)}</strong>{" "}
                  <span className="muted num">({t("matchCount", { count: tri.matches[k] })})</span>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
