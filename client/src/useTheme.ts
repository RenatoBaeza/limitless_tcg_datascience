import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { reducedMotion } from "./fx/motion";
import type { Mode } from "./scale";

const STORAGE_KEY = "duelmeta-theme";
// The key from before the rebrand, read once so a saved choice survives it.
const LEGACY_STORAGE_KEY = "limitless-theme";

/** Where a theme switch was triggered from, so the reveal can grow out of it. */
export type Origin = { x: number; y: number };

const read = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return null;
  }
};

/**
 * The viewer's light/dark choice, defaulting to the OS setting.
 *
 * The mode is also handed to the colour scale, which has its own set of stops
 * per mode rather than inverting one set - see scale.ts. So this has to be
 * real state and not only a CSS media query.
 *
 * Switching uses the View Transitions API where there is one: the browser
 * snapshots the old page, and the new theme is revealed through a circle
 * expanding from the toggle. Without it (or under reduced motion) the switch
 * is simply instant.
 */
export function useTheme(): [Mode, (mode: Mode, origin?: Origin) => void] {
  const [mode, setMode] = useState<Mode>(() => {
    const stored = read();
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", mode === "dark" ? "#0e121b" : "#f6f3ea");
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* private mode: the choice just will not persist */
    }
  }, [mode]);

  useEffect(() => {
    // Follow the OS only while the viewer has not overridden it.
    if (read()) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setMode(event.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const change = (next: Mode, origin?: Origin) => {
    if (next === mode) return;

    const apply = () => {
      // Set the attribute here too, not only in the effect: the transition
      // snapshots the new state as soon as this callback returns.
      document.documentElement.dataset.theme = next;
      flushSync(() => setMode(next));
    };

    if (!document.startViewTransition || reducedMotion()) {
      apply();
      return;
    }

    const x = origin?.x ?? window.innerWidth - 40;
    const y = origin?.y ?? 40;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    // The browser can skip a transition (a hidden tab, a second click mid-way).
    // The theme still changes - apply always runs - so a skip only means no
    // reveal, and the rejected promise is not an error worth surfacing.
    document
      .startViewTransition(apply)
      .ready.then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 650, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" },
        );
      })
      .catch(() => {});
  };

  return [mode, change];
}
