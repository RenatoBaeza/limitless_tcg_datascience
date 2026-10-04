import { useLayoutEffect, useRef, type RefObject } from "react";
import { reducedMotion } from "./motion";

/**
 * FLIP for table rows: when the order changes, every row that moved glides
 * from where it was to where it now is, instead of the table snapping.
 *
 * After each render it records each `[data-flip]` row's offsetTop. On the
 * next render that changes `order`, it compares, and plays the difference
 * back as a transform from the old place to none. Offsets are relative to the
 * table, so scrolling between renders does not throw them off.
 */
export function useFlip(container: RefObject<HTMLElement | null>, order: string) {
  const positions = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const rows = root.querySelectorAll<HTMLElement>("[data-flip]");
    const animate = !reducedMotion();

    rows.forEach((row) => {
      const key = row.dataset.flip!;
      const before = positions.current.get(key);
      const after = row.offsetTop;
      positions.current.set(key, after);
      if (!animate || before == null || before === after) return;

      const distance = before - after;
      row.animate(
        [
          { transform: `translateY(${distance}px)`, zIndex: 1 },
          { transform: "translateY(0)", zIndex: 1 },
        ],
        { duration: 520 + Math.min(Math.abs(distance), 600) * 0.4, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    });
  }, [container, order]);
}
