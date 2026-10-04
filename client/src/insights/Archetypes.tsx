import { useMemo, useState, type CSSProperties } from "react";
import type { Archetypes as ArchetypeData, DeckRate } from "../analysis";
import { DeckIcon } from "../components/DeckIcon";
import { Tooltip, type Anchor } from "../components/Tooltip";
import { useI18n } from "../i18n";

const W = 1000;
const H = 420;
const PAD = 30;
const INSET = 16;
const LABEL_SPACE = 150;
const LABELLED = 8;
const MEMBERS_SHOWN = 14;
const WEAK = 0.25;

/**
 * Two hues, validated as a pair in both modes (all-pairs, since this is a
 * scatter): orange and aqua, kept clear of the matrix's blue/red and of any
 * purple. A third group and beyond fall back to neutral ink - by then the
 * shape is what tells them apart, and every marker has one.
 */
const clusterColor = (c: number) => (c < 2 ? `var(--cluster-${c + 1})` : "var(--cluster-other)");
const SHAPES = ["circle", "square", "diamond", "triangle"] as const;
const shapeOf = (c: number) => SHAPES[c % SHAPES.length];
/** Marker radius from meta share: grows with its square root, so area roughly tracks share,
 * on a floor that keeps the rarest deck a visible, hoverable mark. */
const radius = (share: number) => 4 + Math.sqrt(share) * 22;

function Marker({ cluster, size, className }: { cluster: number; size: number; className?: string }) {
  const s = size;
  const props = { className, style: { fill: clusterColor(cluster) } };
  switch (shapeOf(cluster)) {
    case "square":
      return <rect x={-s * 0.85} y={-s * 0.85} width={s * 1.7} height={s * 1.7} rx={1.5} {...props} />;
    case "diamond":
      return <path d={`M0,${-s * 1.15} L${s * 1.15},0 L0,${s * 1.15} L${-s * 1.15},0Z`} {...props} />;
    case "triangle":
      return <path d={`M0,${-s * 1.15} L${s * 1.1},${s * 0.8} L${-s * 1.1},${s * 0.8}Z`} {...props} />;
    default:
      return <circle r={s} {...props} />;
  }
}

export function Swatch({ cluster }: { cluster: number }) {
  return (
    <svg viewBox="-8 -8 16 16" width="14" height="14" className="cluster-swatch" aria-hidden="true">
      <Marker cluster={cluster} size={6} />
    </svg>
  );
}

/**
 * Decks placed by how they match up, not by what they play, and the groups
 * the clustering found among them.
 *
 * The axes are the first two principal components of the matchup profiles,
 * which have no units worth printing - only distance means anything - so the
 * axes carry their share of the variance instead of ticks. The biggest decks
 * are labelled where they sit; the rest are a hover away, and every deck is in
 * a group card below, so nothing depends on the hover.
 *
 * The silhouette is reported as found. When it is weak the panel says so
 * first, because a confident-looking scatter of overlapping groups is exactly
 * the chart that misleads.
 */
export function Archetypes({ archetypes, names }: { archetypes: ArchetypeData; names: Record<string, string> }) {
  const { t, percentSign, count } = useI18n();
  const [hover, setHover] = useState<{ index: number; anchor: Anchor } | null>(null);
  const name = (id: string) => names[id] ?? id;

  const { points, labelled } = useMemo(() => {
    const xs = archetypes.decks.map((d) => d.x);
    const ys = archetypes.decks.map((d) => d.y);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    const sx = (x: number) => PAD + INSET + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * PAD - INSET - LABEL_SPACE);
    const sy = (y: number) => H - PAD - INSET - ((y - y0) / (y1 - y0 || 1)) * (H - 2 * PAD - 2 * INSET);
    const placed = archetypes.decks.map((d) => ({ ...d, px: sx(d.x), py: sy(d.y), r: radius(d.share) }));

    // Label the biggest decks, skipping any whose label would land on one
    // already placed. A skipped deck is still a hover away, and in its card.
    const boxes: Array<[number, number, number, number]> = [];
    const top = new Set<string>();
    for (const d of [...placed].sort((a, b) => b.share - a.share).slice(0, LABELLED)) {
      const x = d.px + d.r + 6;
      const box: [number, number, number, number] = [x, d.py - 9, x + (names[d.deck_id] ?? d.deck_id).length * 7, d.py + 9];
      if (boxes.some((b) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) continue;
      boxes.push(box);
      top.add(d.deck_id);
    }
    return { points: placed, labelled: top };
  }, [archetypes.decks, names]);

  const groups = archetypes.clusters.map((cluster, c) => {
    const members = archetypes.decks.filter((d) => d.cluster === c).sort((a, b) => b.share - a.share);
    return { ...cluster, index: c, members, lead: members[0] };
  });

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * W;
    const y = ((event.clientY - box.top) / box.height) * H;
    let best = -1;
    let bestDistance = 18 ** 2;
    points.forEach((p, i) => {
      const d = (p.px - x) ** 2 + (p.py - y) ** 2;
      if (d < bestDistance) [best, bestDistance] = [i, d];
    });
    setHover(best < 0 ? null : { index: best, anchor: { x: event.clientX, y: event.clientY } });
  };

  const hovered = hover ? points[hover.index] : null;
  const weak = archetypes.silhouette < WEAK;

  return (
    <div className="archetypes">
      <p className={`archetype-verdict${weak ? " is-weak" : ""}`}>
        {t(weak ? "archetypesWeak" : "archetypesClear", { value: archetypes.silhouette.toFixed(2) })}
      </p>

      <div className="archetype-legend">
        {groups.map((g) => (
          <span key={g.index} className="legend-item">
            <Swatch cluster={g.index} />
            {t("clusterName", { number: g.index + 1 })}
            <span className="muted">· {t("clusterLed", { name: name(g.lead.deck_id) })}</span>
          </span>
        ))}
      </div>

      <div className="scatter-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="scatter"
          role="img"
          aria-label={t("archetypesTitle")}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <line x1={PAD} y1={H - PAD} x2={W - PAD - LABEL_SPACE} y2={H - PAD} className="axis-line" />
          <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} className="axis-line" />
          <text x={W - PAD - LABEL_SPACE} y={H - 8} textAnchor="end" className="axis-label">
            {t("axisProfile", { number: 1, share: percentSign(archetypes.explained[0], 0) })}
          </text>
          <text x={12} y={PAD - 10} className="axis-label">
            {t("axisProfile", { number: 2, share: percentSign(archetypes.explained[1], 0) })}
          </text>

          {points.map((p, i) => (
            <g key={p.deck_id} transform={`translate(${p.px},${p.py})`} className={hover?.index === i ? "point is-hover" : "point"}>
              <Marker cluster={p.cluster} size={p.r} />
            </g>
          ))}
          {points
            .filter((p) => labelled.has(p.deck_id))
            .map((p) => (
              <text key={p.deck_id} x={p.px + p.r + 6} y={p.py + 4} className="point-label">
                {name(p.deck_id)}
              </text>
            ))}
        </svg>
      </div>

      {hovered && hover && (
        <Tooltip anchor={hover.anchor}>
          <div className="tip-matchup">
            <DeckIcon deckId={hovered.deck_id} />
            <strong>{name(hovered.deck_id)}</strong>
          </div>
          <dl>
            <dt>{t("clusterLabel")}</dt>
            <dd>
              <Swatch cluster={hovered.cluster} /> {hovered.cluster + 1}
            </dd>
            <dt>{t("metaShare")}</dt>
            <dd>{percentSign(hovered.share)}</dd>
            <dt>{t("stability")}</dt>
            <dd>{percentSign(hovered.stability, 0)}</dd>
          </dl>
        </Tooltip>
      )}

      <div className="cluster-cards">
        {groups.map((g) => (
          <section key={g.index} className="cluster-card" style={{ "--i": g.index } as CSSProperties}>
            <header>
              <h3>
                <Swatch cluster={g.index} />
                {t("clusterName", { number: g.index + 1 })}
              </h3>
              <p className="muted">
                {t("clusterStats", {
                  count: count(g.members.length),
                  share: percentSign(g.share, 0),
                  stability: percentSign(g.stability, 0),
                })}
              </p>
            </header>

            <ul className="cluster-members">
              {g.members.slice(0, MEMBERS_SHOWN).map((d) => (
                <li key={d.deck_id} title={`${name(d.deck_id)} · ${percentSign(d.share)} · ${t("stability")} ${percentSign(d.stability, 0)}`}>
                  <DeckIcon deckId={d.deck_id} />
                  <span>{name(d.deck_id)}</span>
                </li>
              ))}
              {g.members.length > MEMBERS_SHOWN && (
                <li className="muted">{t("andMore", { count: g.members.length - MEMBERS_SHOWN })}</li>
              )}
            </ul>

            <div className="cluster-matchups">
              <MatchupList title={t("bestAgainst")} rows={g.best} name={name} />
              <MatchupList title={t("worstAgainst")} rows={g.worst} name={name} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function MatchupList({ title, rows, name }: { title: string; rows: DeckRate[]; name: (id: string) => string }) {
  const { t, percentSign } = useI18n();
  return (
    <div>
      <h4>{title}</h4>
      <ul>
        {rows.map((r) => (
          <li key={r.deck_id} title={t("matchCount", { count: r.matches })}>
            <DeckIcon deckId={r.deck_id} />
            <span className="cluster-opponent">{name(r.deck_id)}</span>
            <strong className="num">{percentSign(r.rate, 0)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
