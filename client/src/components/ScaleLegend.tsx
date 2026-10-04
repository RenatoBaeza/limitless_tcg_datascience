import type { CSSProperties } from "react";
import { percent } from "../format";
import { SCALE_DOMAIN, scaleSwatches, scoreColor, type Mode } from "../scale";

/**
 * The scale legend. Mandatory rather than decorative: the matrix encodes a
 * continuous value in colour, and without the ramp and its endpoints a reader
 * has no way to know that the scale saturates at 25% and 75% rather than at 0
 * and 100.
 *
 * While a cell is hovered, a marker slides along the ramp to that cell's rate,
 * tying the colour under the cursor back to the scale that produced it.
 */
export function ScaleLegend({ mode, marker = null }: { mode: Mode; marker?: number | null }) {
  const low = Math.round((0.5 - SCALE_DOMAIN) * 100);
  const high = Math.round((0.5 + SCALE_DOMAIN) * 100);
  const at =
    marker == null ? 50 : Math.max(0, Math.min(100, ((marker - (0.5 - SCALE_DOMAIN)) / (2 * SCALE_DOMAIN)) * 100));

  return (
    <div className="legend">
      <span className="legend-end">≤{low}%</span>
      <div className="legend-ramp" aria-hidden="true">
        {scaleSwatches(mode).map((swatch, i) => (
          <span key={swatch.rate} style={{ background: swatch.background, "--i": i } as CSSProperties} />
        ))}
        <span
          className={`legend-marker${marker == null ? "" : " is-on"}`}
          style={
            {
              left: `${at}%`,
              "--c": marker == null ? "transparent" : scoreColor(marker, mode).background,
            } as CSSProperties
          }
        >
          {marker != null && <b>{percent(marker)}</b>}
        </span>
      </div>
      <span className="legend-end">≥{high}%</span>
      <span className="muted">score rate</span>

      <span className="legend-key">
        <Chip rate={0.62} mode={mode} />
        clear of 50%
      </span>
      <span className="legend-key">
        <Chip rate={0.62} mode={mode} muted />
        could still be even
      </span>
      <span className="legend-key">
        <span className="swatch mirror" />
        mirror
      </span>
      <span className="legend-key">
        <span className="swatch empty" />
        too few matches
      </span>
    </div>
  );
}

/** A miniature matrix cell, drawn exactly as the grid draws one. */
function Chip({ rate, mode, muted = false }: { rate: number; mode: Mode; muted?: boolean }) {
  const { background, ink, edge } = scoreColor(rate, mode, muted);
  return (
    <span
      className={`legend-chip${muted ? " muted" : ""}`}
      style={{ backgroundColor: background, color: ink, "--edge": edge } as CSSProperties}
    >
      {percent(rate)}
    </span>
  );
}
