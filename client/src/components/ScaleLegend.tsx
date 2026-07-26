import { SCALE_DOMAIN, scaleSwatches, type Mode } from "../scale";

/**
 * The scale legend. Mandatory rather than decorative: the matrix encodes a
 * continuous value in colour, and without the ramp and its endpoints a reader
 * has no way to know that the scale saturates at 25% and 75% rather than at 0
 * and 100.
 */
export function ScaleLegend({ mode }: { mode: Mode }) {
  const low = Math.round((0.5 - SCALE_DOMAIN) * 100);
  const high = Math.round((0.5 + SCALE_DOMAIN) * 100);

  return (
    <div className="legend">
      <span>≤{low}%</span>
      <div className="legend-ramp" aria-hidden="true">
        {scaleSwatches(mode).map((swatch) => (
          <span key={swatch.rate} style={{ background: swatch.background }} />
        ))}
      </div>
      <span>≥{high}%</span>
      <span className="muted">score rate</span>

      <span className="legend-key">
        <span className="swatch" />
        mirror
      </span>
      <span className="legend-key">
        <span className="dotted">56</span>
        range still spans 50%
      </span>
    </div>
  );
}
