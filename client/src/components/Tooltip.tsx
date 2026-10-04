import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { percentSign } from "../format";

export type Anchor = { x: number; y: number };

const OFFSET = 16;
const WIDTH = 270;
const HEIGHT = 250;

/**
 * A floating readout, positioned beside the pointer and flipped when it would
 * run off the viewport.
 *
 * Portalled to <body>: a panel mid-reveal carries a transform and a filter,
 * and either makes it the containing block for anything position: fixed
 * inside it, which would pin the tooltip to the panel instead of the viewport.
 *
 * `pointer-events: none` in the stylesheet keeps it from stealing the hover it
 * was opened by. Everything it shows is also in the table view, so a reader who
 * never hovers still gets every number.
 */
export function Tooltip({ anchor, children }: { anchor: Anchor; children: ReactNode }) {
  const flipX = anchor.x > window.innerWidth - WIDTH - OFFSET * 2;
  const flipY = anchor.y > window.innerHeight - HEIGHT - OFFSET * 2;
  const x = flipX ? anchor.x - WIDTH - OFFSET : anchor.x + OFFSET;
  const y = flipY ? anchor.y - HEIGHT - OFFSET : anchor.y + OFFSET;

  return createPortal(
    <div
      className="tooltip"
      role="tooltip"
      style={{ transform: `translate3d(${Math.max(8, x)}px, ${Math.max(8, y)}px, 0)` }}
    >
      <div className="tooltip-inner">{children}</div>
    </div>,
    document.body,
  );
}

/**
 * The rate and its 95% interval on the matrix's own 25-75% axis, so the width
 * of the uncertainty is something you see rather than two numbers you subtract.
 */
export function IntervalReadout({
  rate,
  low,
  high,
  color,
}: {
  rate: number | null;
  low: number | null;
  high: number | null;
  color: string;
}) {
  const at = (v: number) => Math.max(0, Math.min(100, ((v - 0.25) / 0.5) * 100));
  const r = rate ?? 0.5;
  const lo = low ?? r;
  const hi = high ?? r;

  return (
    <div className="tip-interval" aria-hidden="true">
      <div className="tip-track">
        <span className="tip-even" />
        <span className="tip-range" style={{ left: `${at(lo)}%`, width: `${at(hi) - at(lo)}%`, background: color }} />
        <span className="tip-point" style={{ left: `${at(r)}%`, background: color }} />
      </div>
      <div className="tip-axis">
        <span>25</span>
        <span>{percentSign(lo, 0)} – {percentSign(hi, 0)}</span>
        <span>75</span>
      </div>
    </div>
  );
}
