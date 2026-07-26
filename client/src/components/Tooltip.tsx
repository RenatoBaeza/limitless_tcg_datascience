import type { ReactNode } from "react";

export type Anchor = { x: number; y: number };

/**
 * A floating readout, positioned beside the pointer and flipped when it would
 * run off the viewport.
 *
 * `pointer-events: none` in the stylesheet keeps it from stealing the hover it
 * was opened by. Everything it shows is also in the table view, so a reader who
 * never hovers still gets every number.
 */
export function Tooltip({ anchor, children }: { anchor: Anchor; children: ReactNode }) {
  const OFFSET = 14;
  const flipX = anchor.x > window.innerWidth - 290;
  const flipY = anchor.y > window.innerHeight - 190;

  return (
    <div
      className="tooltip"
      role="tooltip"
      style={{
        left: flipX ? undefined : anchor.x + OFFSET,
        right: flipX ? window.innerWidth - anchor.x + OFFSET : undefined,
        top: flipY ? undefined : anchor.y + OFFSET,
        bottom: flipY ? window.innerHeight - anchor.y + OFFSET : undefined,
      }}
    >
      {children}
    </div>
  );
}
