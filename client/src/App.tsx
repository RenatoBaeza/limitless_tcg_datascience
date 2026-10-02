import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchCoverage, fetchDecks, fetchMatrix } from "./api";
import { DeckDetail } from "./components/DeckDetail";
import { DeckTable } from "./components/DeckTable";
import { FilterBar } from "./components/FilterBar";
import { MatchupMatrix } from "./components/MatchupMatrix";
import { MatchupTable } from "./components/MatchupTable";
import { ScaleLegend } from "./components/ScaleLegend";
import { StatTiles } from "./components/StatTiles";
import { DEFAULT_FILTERS, type Filters, type View } from "./filters";
import { count, relativeTime } from "./format";
import { useTheme } from "./useTheme";

export default function App() {
  const [mode, setMode] = useTheme();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [view, setView] = useState<View>("matrix");
  const [selected, setSelected] = useState<string | null>(null);

  const coverage = useQuery({ queryKey: ["coverage"], queryFn: fetchCoverage });

  // Every panel below scopes to this one period, so their numbers always agree.
  // The server resolves its dates, so nothing here waits on coverage first.
  const { period } = filters;

  const decks = useQuery({
    queryKey: ["decks", period, filters.axis, filters.includeOther],
    queryFn: () => fetchDecks(period, filters.axis, filters.includeOther),
    placeholderData: (previous) => previous,
  });

  const matrix = useQuery({
    queryKey: ["matrix", period, filters.axis, filters.minMatches, filters.includeOther],
    queryFn: () => fetchMatrix(period, filters.axis, filters.minMatches, filters.includeOther),
    placeholderData: (previous) => previous,
  });

  const selectedDeck = decks.data?.find((deck) => deck.deck_id === selected) ?? null;
  const stale = decks.isPlaceholderData || matrix.isPlaceholderData;
  const failure = (coverage.error ?? decks.error ?? matrix.error) as Error | null;

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Limitless metagame</h1>
          <div className="header-meta">
            {coverage.data ? (
              <>
                {count(coverage.data.tournaments)} tournaments
                <span className="dot">·</span>
                {count(coverage.data.matches)} matches
                <span className="dot">·</span>
                {count(coverage.data.decks)} decks
                <span className="dot">·</span>
                {coverage.data.first_event} to {coverage.data.last_event}
                <span className="dot">·</span>
                refreshed {relativeTime(coverage.data.refreshed_at)}
              </>
            ) : (
              "Loading…"
            )}
          </div>
        </div>

        <div className="segmented" role="group" aria-label="Colour theme">
          <button
            type="button"
            aria-pressed={mode === "light"}
            onClick={() => setMode("light")}
          >
            Light
          </button>
          <button type="button" aria-pressed={mode === "dark"} onClick={() => setMode("dark")}>
            Dark
          </button>
        </div>
      </header>

      <FilterBar filters={filters} onChange={setFilters} view={view} onViewChange={setView} />

      {failure && (
        <p className="error">
          {failure.message}. Is the API running? <code>uv run uvicorn app.main:app --reload</code>{" "}
          in <code>server/</code>.
        </p>
      )}

      {coverage.data?.matches === 0 && (
        <p className="notice">
          The gold layer is empty. Apply <code>server/sql/012_gold_finished.sql</code>, then run{" "}
          <code>uv run python scripts/refresh_gold.py</code> in <code>server/</code>.
        </p>
      )}

      {decks.data && matrix.data && (
        <div className={stale ? "stale" : undefined}>
          <StatTiles decks={decks.data} cells={matrix.data} />
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Matchups</h2>
            <p className="panel-note">
              Each cell is the row deck&rsquo;s score rate against the column deck, counting a tie
              as half a win. Cells under {filters.minMatches} matches are left blank.
            </p>
          </div>
          {view === "matrix" && <ScaleLegend mode={mode} />}
        </div>

        <div className={stale ? "stale" : undefined}>
          {!decks.data || !matrix.data ? (
            <p className="notice">Loading matchups…</p>
          ) : view === "matrix" ? (
            <MatchupMatrix
              decks={decks.data}
              cells={matrix.data}
              mode={mode}
              minMatches={filters.minMatches}
              onSelect={setSelected}
            />
          ) : (
            <MatchupTable decks={decks.data} cells={matrix.data} onSelect={setSelected} />
          )}
        </div>
      </section>

      {selectedDeck && (
        <DeckDetail
          deck={selectedDeck}
          period={period}
          minMatches={filters.minMatches}
          includeOther={filters.includeOther}
          onClose={() => setSelected(null)}
        />
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Decks</h2>
            <p className="panel-note">
              Score rate counts a tie as half a win, so it and the excluding-ties column differ by
              a point or two. Both are over non-mirror matches only.
            </p>
          </div>
        </div>

        <div className={stale ? "stale" : undefined}>
          {decks.data ? (
            <DeckTable decks={decks.data} selected={selected} onSelect={setSelected} />
          ) : (
            <p className="notice">Loading decks…</p>
          )}
        </div>
      </section>
    </div>
  );
}
