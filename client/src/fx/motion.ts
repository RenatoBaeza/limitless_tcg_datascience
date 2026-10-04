import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * The motion layer's small shared toolkit. Every effect on the page checks
 * `prefers-reduced-motion` through here, so a viewer who asked for less motion
 * gets the same page with the movement taken out - final values straight away,
 * no drift, no tilt - rather than a page with parts missing.
 */

const REDUCE = "(prefers-reduced-motion: reduce)";

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia(REDUCE).matches;

function subscribe(onChange: () => void) {
  const media = window.matchMedia(REDUCE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export const useReducedMotion = () => useSyncExternalStore(subscribe, reducedMotion, () => false);

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

/**
 * A number that rolls to its target instead of jumping. Starts from wherever
 * it currently is, so changing the filter mid-roll stays continuous.
 */
export function useCountUp(target: number, duration = 1100): number {
  const [value, setValue] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    if (reducedMotion()) {
      current.current = target;
      setValue(target);
      return;
    }

    const from = current.current;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      current.current = from + (target - from) * easeOutExpo(t);
      setValue(current.current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

/** Adds `is-in` to an element the first time it scrolls into view. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (reducedMotion() || !("IntersectionObserver" in window)) {
      element.classList.add("is-in");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.04 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return ref;
}

/**
 * A counter that moves on whenever `value` is a new object. Used as a React
 * key so an animation replays when fresh data lands, but not when a filter
 * change is still showing the previous result as a placeholder.
 */
export function useVersion(value: unknown): number {
  const last = useRef<unknown>(undefined);
  const version = useRef(0);
  if (value !== last.current) {
    last.current = value;
    version.current += 1;
  }
  return version.current;
}
