/**
 * One pointer listener for the whole page.
 *
 * It writes the cursor position to CSS custom properties and leaves everything
 * else to the stylesheet:
 *
 *   .lattice.lit   --cx / --cy   viewport coordinates, for the backdrop flashlight
 *   .glow > .spot  --mx / --my   coordinates local to each card, for the border
 *                                spotlight that tracks the cursor around its edge
 *
 * The properties go on leaf elements, never on :root or the card itself.
 * Custom properties inherit, so setting one on an element restyles its whole
 * subtree - on the matrix panel that would be 1600 cells, every frame.
 *
 * Writes are batched to one per frame, and React never hears about the
 * pointer at all.
 */
export function trackPointer(): () => void {
  let frame = 0;
  let x = -1000;
  let y = -1000;

  const flush = () => {
    frame = 0;

    const lattice = document.querySelector<HTMLElement>(".lattice.lit");
    lattice?.style.setProperty("--cx", `${x}px`);
    lattice?.style.setProperty("--cy", `${y}px`);

    for (const card of document.querySelectorAll<HTMLElement>(".glow")) {
      const box = card.getBoundingClientRect();
      // Skip cards nowhere near the cursor.
      if (y < box.top - 300 || y > box.bottom + 300) continue;
      const spot = card.querySelector<HTMLElement>(":scope > .spot");
      spot?.style.setProperty("--mx", `${x - box.left}px`);
      spot?.style.setProperty("--my", `${y - box.top}px`);
    }
  };

  const onMove = (event: PointerEvent) => {
    x = event.clientX;
    y = event.clientY;
    if (!frame) frame = requestAnimationFrame(flush);
  };

  window.addEventListener("pointermove", onMove, { passive: true });
  return () => {
    window.removeEventListener("pointermove", onMove);
    cancelAnimationFrame(frame);
  };
}
