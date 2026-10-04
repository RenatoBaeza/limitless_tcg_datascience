import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { fetchCoverage, fetchDecks, fetchMatrix } from "./api";
import { DeckDetail } from "./components/DeckDetail";
import { DeckTable } from "./components/DeckTable";
import { FilterBar } from "./components/FilterBar";
import { Header } from "./components/Header";
import { MatchupMatrix } from "./components/MatchupMatrix";
import { MatchupTable } from "./components/MatchupTable";
import { GridIcon, Panel, Skeleton, StackIcon } from "./components/Panel";
import { StatTiles } from "./components/StatTiles";
import { DEFAULT_FILTERS, type Filters, type View } from "./filters";
import { Backdrop } from "./fx/Backdrop";
import { useI18n } from "./i18n";
import { useTheme } from "./useTheme";

export default function App() {
  const { t } = useI18n();
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
  const fade = stale ? "stale" : "fresh";

  // Stable, so the memoised matrix grid and deck table skip re-rendering when
  // only the hover or the drawer changes.
  const select = useCallback((deckId: string) => setSelected(deckId), []);
  const canOpen = (deckId: string) => decks.data?.some((deck) => deck.deck_id === deckId) ?? false;

  return (
    <>
      <Backdrop />
      <div className="scroll-progress" aria-hidden="true" />

      <div className="app">
        <Header coverage={coverage.data} mode={mode} onMode={setMode} />

        <FilterBar
          filters={filters}
          onChange={setFilters}
          view={view}
          onViewChange={setView}
          busy={decks.isFetching || matrix.isFetching}
        />

        {failure && (
          <p className="error">
            {t("loadError")}
          </p>
        )}

        {coverage.data?.matches === 0 && (
          <p className="notice">
            {t("emptyData")}
          </p>
        )}

        <div className={fade}>
          {decks.data && matrix.data ? (
            <StatTiles decks={decks.data} cells={matrix.data} />
          ) : (
            <div className="tiles">
              {[0, 1, 2].map((i) => (
                <span key={i} className="skeleton" style={{ height: 236, borderRadius: 16 }} />
              ))}
            </div>
          )}
        </div>

        <Panel
          icon={<GridIcon />}
          title={t("matchups")}
          note={t("matchupNote", { count: filters.minMatches })}
        >
          <div className={fade}>
            {!decks.data || !matrix.data ? (
              <Skeleton rows={8} height={40} />
            ) : (
              <div key={view} className="view-swap matrix-wrap">
                {view === "matrix" ? (
                  <MatchupMatrix
                    decks={decks.data}
                    cells={matrix.data}
                    mode={mode}
                    minMatches={filters.minMatches}
                    onSelect={select}
                  />
                ) : (
                  <MatchupTable decks={decks.data} cells={matrix.data} onSelect={select} mode={mode} />
                )}
              </div>
            )}
          </div>
        </Panel>

        <Panel
          icon={<StackIcon />}
          title={t("decksTitle")}
          note={t("deckNote")}
        >
          <div className={fade}>
            {decks.data ? (
              <DeckTable decks={decks.data} selected={selected} onSelect={select} />
            ) : (
              <Skeleton rows={10} height={34} />
            )}
          </div>
        </Panel>

        <footer className="footer">
          <span>{t("dataSource")}</span>
          <span className="sep" />
          <span>{t("refreshSchedule")}</span>
          <span className="sep" />
          <span>{t("intervalNote")}</span>
        </footer>
      </div>

      {selectedDeck && (
        <DeckDetail
          deck={selectedDeck}
          period={period}
          minMatches={filters.minMatches}
          includeOther={filters.includeOther}
          canOpen={canOpen}
          onSelect={select}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
