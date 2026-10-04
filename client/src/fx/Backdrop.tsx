/**
 * The page's ambient layer, fixed behind everything and inert to the pointer.
 *
 *   lattice    a faint dot grid, fading out down the page
 *   watermark  two outline Poké Balls, the way the games' menu screens carry
 *              one in the corner
 *
 * Nothing here moves. It carries no information, so it stays out of the way:
 * ink on card stock, no blue or red (those are the data's).
 */
export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="lattice" />
      <PokeballOutline className="watermark w1" />
      <PokeballOutline className="watermark w2" />
    </div>
  );
}

function PokeballOutline({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3">
      <circle cx="50" cy="50" r="46" />
      <path d="M4 50h30M66 50h30" />
      <circle cx="50" cy="50" r="15" />
      <circle cx="50" cy="50" r="8" />
    </svg>
  );
}
