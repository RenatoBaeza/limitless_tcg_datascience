import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { DeckMatchup, DeckSummary, Period } from "../api";
import { fetchDeckMatchups } from "../api";
import { spansEven } from "../format";
import { useI18n } from "../i18n";
import { reducedMotion, useCountUp } from "../fx/motion";
import { useFlip } from "../fx/useFlip";
import { DeckIcon } from "./DeckIcon";
import { Segmented } from "./Segmented";
import { Skeleton } from "./Panel";

// The dot plot spans this range, matching the matrix scale so the two views
// are read on the same footing.
const AXIS_LOW = 0.25;
const AXIS_HIGH = 0.75;
const TICKS = [0.3, 0.4, 0.5, 0.6, 0.7];

type Order = "matches" | "best" | "worst";

/**
 * One deck against the whole field, in a drawer over the page.
 *
 * A dot plot rather than bars: the value is a rate, not a magnitude, so there
 * is no meaningful zero for a bar to grow from. A matchup too thin to call
 * either way has its number muted rather than its uncertainty drawn.
 *
 * Each opponent that is itself on screen elsewhere is clickable, and opens
 * that deck in place - so the drawer doubles as a way to walk the metagame
 * one matchup at a time.
 *
 * Dressed as a Pokédex entry: the red band with its lens and lights, the deck
 * on a battle platform in the screen, its rank as the entry number.
 */
export function DeckDetail({
  deck,
  period,
  canOpen,
  onSelect,
  onClose,
}: {
  deck: DeckSummary;
  period: Period;
  canOpen: (deckId: string) => boolean;
  onSelect: (deckId: string) => void;
  onClose: () => void;
}) {
  const { t, percentSign } = useI18n();
  const { data, isPending, isError, isPlaceholderData } = useQuery({
    queryKey: ["deck-matchups", deck.deck_id, period],
    queryFn: () => fetchDeckMatchups(deck.deck_id, period),
    placeholderData: (previous) => previous,
  });

  const [leaving, setLeaving] = useState(false);
  const left = useRef(false);
  const [order, setOrder] = useState<Order>("matches");
  const closeButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // A ref, not the state: the Escape listener below holds the first render's
  // closure, and must still see a close that is already under way.
  const close = () => {
    if (left.current) return;
    left.current = true;
    setLeaving(true);
    window.setTimeout(onClose, reducedMotion() ? 0 : 280);
  };

  // Escape closes, focus moves in and comes back out, and the page behind
  // stops scrolling - without the scrollbar vanishing and shifting the layout.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();

    const gutter = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    document.body.style.paddingRight = `${gutter}px`;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
      previous?.focus?.();
    };
  }, []);

  const rows = data ? sortRows(data, order) : [];
  useFlip(list, `${deck.deck_id} ${rows.map((row) => row.deck_b).join(" ")}`);

  return createPortal(
    <div className={`drawer-root${leaving ? " is-leaving" : ""}`}>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <DexBand />
        <button ref={closeButton} type="button" className="drawer-close" onClick={close} aria-label={t("close")}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>

        <Hero key={deck.deck_id} deck={deck} />

        <div className="drawer-body">
          <div className="drawer-section-head">
            <h3>{t("againstField")}</h3>
            <Segmented
              size="sm"
              label={t("orderOpponents")}
              value={order}
              onChange={setOrder}
              options={[
                { value: "matches", label: t("mostPlayed") },
                { value: "best", label: t("best") },
                { value: "worst", label: t("worst") },
              ]}
            />
          </div>

          {isError && <p className="error">{t("loadError")}</p>}
          {isPending && <Skeleton rows={8} height={28} />}

          {data && (
            <div className={isPlaceholderData ? "stale" : "fresh"}>
              <div className="dots" ref={list} key={deck.deck_id}>
                {rows.map((matchup, i) => (
                  <DotRow
                    key={matchup.deck_b}
                    matchup={matchup}
                    index={i}
                    onOpen={canOpen(matchup.deck_b) ? () => onSelect(matchup.deck_b) : undefined}
                  />
                ))}
              </div>

              {rows.length > 0 && (
                <div className="dot-axis">
                  <span />
                  <div className="ticks">
                    {TICKS.map((tick) => (
                      <span key={tick} style={{ left: `${position(tick)}%` }}>
                        {percentSign(tick, 0)}
                      </span>
                    ))}
                  </div>
                  <span />
                </div>
              )}

              {!data.length && <p className="notice">{t("noOpponents")}</p>}
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function Hero({ deck }: { deck: DeckSummary }) {
  const { t, count, percentSign, record } = useI18n();
  const score = useCountUp((deck.score_rate ?? 0) * 1000, 1200) / 1000;
  const inconclusive = spansEven(deck.score_low, deck.score_high);

  return (
    <header className="drawer-hero">
      <div className="dex-screen" aria-hidden="true">
        <DeckIcon deckId={deck.deck_id} alt="" />
      </div>
      <div className="hero-text">
        <span className="hero-rank">
          {t("rank", { number: String(deck.rank).padStart(3, "0"), rank: deck.rank })}
        </span>
        <h2 id="drawer-title">{deck.deck_name ?? deck.deck_id}</h2>
        <div className="hero-stats">
          <div className="hero-stat">
            <strong className={`num${inconclusive ? " muted" : ""}`}>{percentSign(score)}</strong>
            <span>{t("scoreRate")}</span>
          </div>
          <div className="hero-stat">
            <strong className="num">{count(deck.matches)}</strong>
            <span>{t("matches", { count: deck.matches })}</span>
          </div>
          <div className="hero-stat">
            <strong className="num">{percentSign(deck.meta_share, 2)}</strong>
            <span>{t("ofField")}</span>
          </div>
        </div>
        <div className="hero-record">
          {record(deck.wins, deck.losses, deck.ties)}
        </div>
      </div>
    </header>
  );
}

/** The Pokédex's top band: one big lens and three indicator lights. */
function DexBand() {
  return (
    <div className="dex-band" aria-hidden="true">
      <svg className="dex-shape" viewBox="0 0 100 62" preserveAspectRatio="none">
        <path className="dex-fill" d="M0 0H100V44H62L54 60H0Z" />
        <path className="dex-edge" d="M0 60H54L62 44H100" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="dex-lens" />
      <span className="dex-led" />
      <span className="dex-led" />
      <span className="dex-led" />
    </div>
  );
}

function DotRow({ matchup, index, onOpen }: { matchup: DeckMatchup; index: number; onOpen?: () => void }) {
  const { t, count, percentSign, record } = useI18n();
  const rate = matchup.score_rate ?? 0.5;
  const inconclusive = spansEven(matchup.score_low, matchup.score_high);
  const favoured = !inconclusive && rate > 0.5;
  const unfavoured = !inconclusive && rate < 0.5;

  const label = t("matchupDescription", {
    name: matchup.deck_name ?? matchup.deck_b, rate: percentSign(rate),
    matches: t("matchCount", { count: matchup.matches }),
  });

  const name = (
    <>
      <DeckIcon deckId={matchup.deck_b} />
      <span>{matchup.deck_name ?? matchup.deck_b}</span>
    </>
  );

  return (
    <div
      className={`dot-row${favoured ? " is-up" : ""}${unfavoured ? " is-down" : ""}`}
      data-flip={matchup.deck_b}
      title={label}
      style={{ "--i": Math.min(index, 30) } as CSSProperties}
    >
      {onOpen ? (
        <button type="button" className="dot-label" onClick={onOpen}>
          {name}
        </button>
      ) : (
        <div className="dot-label">{name}</div>
      )}

      <div className="dot-track" role="img" aria-label={label}>
        {TICKS.map((tick) => (
          <div
            key={tick}
            className={`gridline${tick === 0.5 ? " even" : ""}`}
            style={{ left: `${position(tick)}%` }}
          />
        ))}
        <div className="dot" style={{ left: `${position(rate)}%` }} />
      </div>

      <div className="dot-value">
        <strong className={inconclusive ? "muted" : undefined}>{percentSign(rate)}</strong>{" "}
        <span className="muted">
          {record(matchup.wins, matchup.losses, matchup.ties)} · {count(matchup.matches)}
        </span>
      </div>
    </div>
  );
}

function sortRows(rows: DeckMatchup[], order: Order): DeckMatchup[] {
  const sorted = [...rows];
  if (order === "matches") sorted.sort((a, b) => b.matches - a.matches);
  if (order === "best") sorted.sort((a, b) => (b.score_rate ?? 0) - (a.score_rate ?? 0));
  if (order === "worst") sorted.sort((a, b) => (a.score_rate ?? 0) - (b.score_rate ?? 0));
  return sorted;
}

const position = (value: number) =>
  Math.max(0, Math.min(100, ((value - AXIS_LOW) / (AXIS_HIGH - AXIS_LOW)) * 100));
