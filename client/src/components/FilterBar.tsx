import type { Filters, Preset, View } from "../filters";
import { PRESETS } from "../filters";

/**
 * One filter row, above everything it scopes. Date range comes first because
 * it is the control a reader reaches for first, and presets come before any
 * custom range because nobody fights a calendar grid for "last 30 days".
 */
export function FilterBar({
  filters,
  onChange,
  view,
  onViewChange,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  view: View;
  onViewChange: (view: View) => void;
}) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="filters">
      <div className="field">
        <span className="label" id="range-label">
          Date range
        </span>
        <div className="segmented" role="group" aria-labelledby="range-label">
          {(Object.keys(PRESETS) as Preset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={filters.preset === preset}
              onClick={() => set("preset", preset)}
            >
              {PRESETS[preset].label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="axis">Decks shown</label>
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

      <div className="field">
        <label htmlFor="min-matches">Min. matches</label>
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

      <label className="checkbox">
        <input
          type="checkbox"
          checked={filters.includeOther}
          onChange={(event) => set("includeOther", event.target.checked)}
        />
        Include &ldquo;Other&rdquo;
      </label>

      <div className="spacer" />

      <div className="field">
        <span className="label" id="view-label">
          Matchups as
        </span>
        <div className="segmented" role="group" aria-labelledby="view-label">
          {(["matrix", "table"] as View[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => onViewChange(option)}
            >
              {option === "matrix" ? "Matrix" : "Table"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
