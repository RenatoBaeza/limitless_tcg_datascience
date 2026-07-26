import { useEffect, useState } from "react";
import type { Mode } from "./scale";

const STORAGE_KEY = "limitless-theme";

/**
 * The viewer's light/dark choice, defaulting to the OS setting.
 *
 * The mode is also handed to the colour scale, which has its own set of stops
 * per mode rather than inverting one set - see scale.ts. So this has to be
 * real state and not only a CSS media query.
 */
export function useTheme(): [Mode, (mode: Mode) => void] {
  const [mode, setMode] = useState<Mode>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    // Follow the OS only while the viewer has not overridden it.
    if (localStorage.getItem(STORAGE_KEY)) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setMode(event.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return [mode, setMode];
}
