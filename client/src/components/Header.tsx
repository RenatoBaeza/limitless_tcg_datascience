import type { MouseEvent } from "react";
import type { Coverage } from "../api";
import { count, relativeTime } from "../format";
import { useCountUp } from "../fx/motion";
import type { Mode } from "../scale";
import type { Origin } from "../useTheme";

/**
 * The masthead: the mark, the title, and what the data covers.
 *
 * The coverage numbers roll up rather than appear, and the refresh time sits
 * beside a live dot - gold is rebuilt every six hours, so "how fresh is this"
 * is a real question and deserves to be answered at a glance.
 */
export function Header({
  coverage,
  mode,
  onMode,
}: {
  coverage: Coverage | undefined;
  mode: Mode;
  onMode: (mode: Mode, origin?: Origin) => void;
}) {
  return (
    <header className="header">
      <div className="brand">
        <PokeballLogo />
        <div className="brand-text">
          <div className="kicker">Pokémon TCG · competitive metagame</div>
          <h1 className="title">
            <span className="logo-text">Limitless</span> metagame
          </h1>
        </div>
      </div>

      <ThemeToggle mode={mode} onMode={onMode} />

      <div className="coverage" aria-live="polite">
        {coverage ? (
          <>
            <Chip value={coverage.tournaments} label="tournaments" delay={0} />
            <Chip value={coverage.matches} label="matches" delay={1} />
            <Chip value={coverage.decks} label="decks" delay={2} />
            <span className="chip chip-plain" style={{ "--i": 3 } as React.CSSProperties}>
              <CalendarIcon />
              {coverage.first_event} → {coverage.last_event}
            </span>
            <span className="chip chip-plain" style={{ "--i": 4 } as React.CSSProperties}>
              <span className="pulse" aria-hidden="true" />
              refreshed {relativeTime(coverage.refreshed_at)}
            </span>
          </>
        ) : (
          <>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="chip skeleton" style={{ width: 120 }} />
            ))}
          </>
        )}
      </div>
    </header>
  );
}

function Chip({ value, label, delay }: { value: number; label: string; delay: number }) {
  const shown = useCountUp(value, 1600);
  return (
    <span className="chip" style={{ "--i": delay } as React.CSSProperties}>
      <strong className="num">{count(Math.round(shown))}</strong> {label}
    </span>
  );
}

function ThemeToggle({
  mode,
  onMode,
}: {
  mode: Mode;
  onMode: (mode: Mode, origin?: Origin) => void;
}) {
  const next = mode === "dark" ? "light" : "dark";

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onMode(next, { x: box.left + box.width / 2, y: box.top + box.height / 2 });
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      data-mode={mode}
      onClick={onClick}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <mask id="moon-mask">
          <rect width="24" height="24" fill="#fff" />
          <circle className="moon-bite" cx="24" cy="4" r="7" fill="#000" />
        </mask>
        <circle className="sun-core" cx="12" cy="12" r="5" fill="currentColor" mask="url(#moon-mask)" />
        <g className="sun-rays" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i * Math.PI) / 4;
            return (
              <line
                key={i}
                x1={12 + Math.cos(a) * 8}
                y1={12 + Math.sin(a) * 8}
                x2={12 + Math.cos(a) * 10}
                y2={12 + Math.sin(a) * 10}
              />
            );
          })}
        </g>
      </svg>
    </button>
  );
}

/**
 * The mark, drawn inline so it can move. On load it does what a Poké Ball
 * does after a throw - three wobbles, a click, a burst of sparks - and then
 * stays put. Colours match public/pokeball.svg, so the tab icon and the page
 * agree.
 */
function PokeballLogo() {
  return (
    <div className="logo" aria-hidden="true">
      <svg className="logo-ball" viewBox="0 0 32 32" width="52" height="52">
        <defs>
          <clipPath id="logo-clip">
            <circle cx="16" cy="16" r="15" />
          </clipPath>
          <linearGradient id="logo-top" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff5a4e" />
            <stop offset="1" stopColor="#c81f1f" />
          </linearGradient>
          <linearGradient id="logo-bottom" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#d9d7e3" />
          </linearGradient>
        </defs>
        <g clipPath="url(#logo-clip)">
          <rect width="32" height="16" fill="url(#logo-top)" />
          <rect y="16" width="32" height="16" fill="url(#logo-bottom)" />
          <rect y="14" width="32" height="4" fill="#0b0b0b" />
          <ellipse cx="11" cy="7" rx="6" ry="3" fill="#fff" opacity="0.35" />
        </g>
        <circle cx="16" cy="16" r="15" fill="none" stroke="#0b0b0b" strokeWidth="2" />
        <circle cx="16" cy="16" r="5.5" fill="#0b0b0b" />
        <circle className="logo-button" cx="16" cy="16" r="3.2" fill="#fcfcfb" />
      </svg>
      <div className="sparks">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} style={{ "--a": `${i * 45}deg` } as React.CSSProperties} />
        ))}
      </div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" className="chip-icon">
      <rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
