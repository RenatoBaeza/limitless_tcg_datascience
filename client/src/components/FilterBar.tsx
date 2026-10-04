import { useEffect, useRef, useState } from "react";
import type { Period } from "../api";
import type { Filters, View } from "../filters";
import { PRESETS } from "../filters";
import { Segmented } from "./Segmented";

/**
 * One filter row, above everything it scopes. Date range comes first because
 * it is the control a reader reaches for first. It is presets only: each is a
 * period the server computed ahead of time, and nobody fights a calendar grid
 * for "last 30 days" anyway.
 *
 * The bar sticks to the top of the viewport, so the filters stay in reach
 * while reading the deck table far below them. It picks up a shadow once it
 * is actually stuck, which a sentinel element just above it reports.
 */
export function FilterBar({
  filters,
  onChange,
  view,
  onViewChange,
  busy,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  view: View;
  onViewChange: (view: View) => void;
  busy: boolean;
}) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    onChange({ ...filters, [key]: value });

  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const element = sentinel.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      rootMargin: "-1px 0px 0px 0px",
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} className="sticky-sentinel" aria-hidden="true" />
      <div className={`filters glow${stuck ? " is-stuck" : ""}${busy ? " is-busy" : ""}`}>
        <span className="spot" aria-hidden="true" />
        <div className="field">
          <span className="label" id="range-label">
            Date range
          </span>
          <Segmented
            labelledBy="range-label"
            value={filters.period}
            onChange={(period) => set("period", period)}
            options={(Object.keys(PRESETS) as Period[]).map((period) => ({
              value: period,
              label: PRESETS[period].label,
            }))}
          />
        </div>

        <div className="field">
          <label htmlFor="axis">Decks shown</label>
          <div className="select">
            <select
              id="axis"
              value={filters.axis}
              onChange={(event) => set("axis", Number(event.target.value))}
            >
              {[10, 15, 20, 25, 30, 40].map((n) => (
                <option key={n} value={n}>
                  Top {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="min-matches">Min. matches</label>
          <div className="select">
            <select
              id="min-matches"
              value={filters.minMatches}
              onChange={(event) => set("minMatches", Number(event.target.value))}
            >
              {[1, 5, 10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "Any" : `${n}+`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={filters.includeOther}
            onChange={(event) => set("includeOther", event.target.checked)}
          />
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
          Include &ldquo;Other&rdquo;
        </label>

        <div className="spacer" />

        <div className="field">
          <span className="label" id="view-label">
            Matchups as
          </span>
          <Segmented
            labelledBy="view-label"
            value={view}
            onChange={onViewChange}
            options={[
              { value: "matrix", label: "Matrix" },
              { value: "table", label: "Table" },
            ]}
          />
        </div>

        <span className="busy-bar" aria-hidden="true" />
      </div>
    </>
  );
}
