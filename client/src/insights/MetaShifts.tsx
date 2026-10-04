import { memo, useMemo, useState, type CSSProperties } from "react";
import type { Shifts } from "../analysis";
import { DeckIcon } from "../components/DeckIcon";
import { Tooltip, type Anchor } from "../components/Tooltip";
import { useI18n } from "../i18n";

const W = 920;
const H = 210;
const TOP = 26;
const BOTTOM = 26;
const LEFT = 8;
const RIGHT = 8;

const SW = 220;
const SH = 74;

/**
 * When the field changed, in three readings of the same weekly series:
 *
 * - how far the whole deck mix moved each week, the flagged weeks being the
 *   ones that moved far more than usual - set releases and bans;
 * - which decks are on the way up or down right now;
 * - the most played decks' own weekly share, with the levels the change-point
 *   model fitted through it, so a reader can check a flagged week against
 *   what actually happened to each deck.
 *
 * Hovering a week anywhere marks it in every chart at once. Hover only draws a
 * line and changes colour; nothing moves.
 */
export function MetaShifts({ shifts, names }: { shifts: Shifts; names: Record<string, string> }) {
  const { t } = useI18n();
  const [week, setWeek] = useState<number | null>(null);
  const flagged = useMemo(
    () => new Set(shifts.weekly.filter((w) => w.z >= shifts.flag_z).map((w) => w.week)),
    [shifts],
  );

  return (
    <div className="shifts">
      <WeeklyChart shifts={shifts} names={names} flagged={flagged} week={week} onWeek={setWeek} />

      <h3 className="sub-title">{t("trendsTitle")}</h3>
      <p className="panel-note">{t("trendsNote")}</p>
      <Trends shifts={shifts} names={names} />

      <h3 className="sub-title">{t("timelinesTitle")}</h3>
      <p className="panel-note">{t("timelinesNote")}</p>
      <div className="timelines" onPointerLeave={() => setWeek(null)}>
        {shifts.timelines.map((line) => (
          <Timeline
            key={line.deck_id}
            line={line}
            name={names[line.deck_id] ?? line.deck_id}
            weeks={shifts.weeks.length}
            flagged={flagged}
            week={week}
            onWeek={setWeek}
          />
        ))}
      </div>
    </div>
  );
}

function WeeklyChart({
  shifts,
  names,
  flagged,
  week,
  onWeek,
}: {
  shifts: Shifts;
  names: Record<string, string>;
  flagged: Set<number>;
  week: number | null;
  onWeek: (week: number | null) => void;
}) {
  const { t, date, percentSign, language } = useI18n();
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const weeks = shifts.weeks.length;
  const slot = (W - LEFT - RIGHT) / weeks;
  const max = Math.max(...shifts.weekly.map((w) => w.divergence));
  const y = (v: number) => H - BOTTOM - (v / max) * (H - TOP - BOTTOM);
  const sorted = [...shifts.weekly.map((w) => w.divergence)].sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)] ?? 0;

  // One tick per month, on its first week.
  const ticks = shifts.weeks.flatMap((iso, k) =>
    k === 0 || iso.slice(5, 7) !== shifts.weeks[k - 1].slice(5, 7) ? [k] : [],
  );
  const monthFormat = new Intl.DateTimeFormat(language, { month: "short", timeZone: "UTC" });

  const current = week == null ? null : shifts.weekly.find((w) => w.week === week);

  return (
    <div className="weekly">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="weekly-svg"
        role="img"
        aria-label={t("shiftsTitle")}
        onPointerLeave={() => {
          onWeek(null);
          setAnchor(null);
        }}
      >
        <line x1={LEFT} x2={W - RIGHT} y1={H - BOTTOM} y2={H - BOTTOM} className="axis-line" />
        <line x1={LEFT} x2={W - RIGHT} y1={y(typical)} y2={y(typical)} className="typical-line" />

        {shifts.weekly.map((w, i) => {
          const x = LEFT + w.week * slot;
          const isFlag = flagged.has(w.week);
          const top = y(w.divergence);
          return (
            <g key={w.week}>
              <rect
                x={x + 2}
                y={top}
                width={Math.max(2, slot - 4)}
                height={H - BOTTOM - top}
                rx={3}
                className={`week-bar${isFlag ? " is-flag" : ""}${week === w.week ? " is-hover" : ""}`}
                style={{ "--i": i } as CSSProperties}
              />
              {isFlag && (
                <text x={x + slot / 2} y={top - 7} textAnchor="middle" className="flag-mark">
                  ⚑
                </text>
              )}
              <rect
                x={x}
                y={0}
                width={slot}
                height={H}
                className="hit"
                onPointerMove={(event) => {
                  onWeek(w.week);
                  setAnchor({ x: event.clientX, y: event.clientY });
                }}
              />
            </g>
          );
        })}

        <text x={W - RIGHT} y={y(typical) - 5} textAnchor="end" className="axis-label typical-label">
          {t("typicalWeek")}
        </text>

        {ticks.map((k) => (
          <text key={k} x={LEFT + k * slot + 2} y={H - 8} className="axis-label">
            {monthFormat.format(new Date(shifts.weeks[k]))}
          </text>
        ))}
      </svg>

      {current && anchor && (
        <Tooltip anchor={anchor}>
          <div className="who">{t("weekOf", { date: date(shifts.weeks[current.week]) })}</div>
          <div className="tip-big num">
            {current.z >= 0 ? "+" : ""}
            {current.z.toFixed(1)}
            <span className="muted"> {t("shiftUnit")}</span>
          </div>
          <div className="secondary">{t("deckChanges", { count: current.changes })}</div>
          {current.movers.length > 0 && (
            <dl>
              {current.movers.map((m) => (
                <MoverRow key={m.deck_id} name={names[m.deck_id] ?? m.deck_id} before={percentSign(m.before)} after={percentSign(m.after)} />
              ))}
            </dl>
          )}
        </Tooltip>
      )}
    </div>
  );
}

function MoverRow({ name, before, after }: { name: string; before: string; after: string }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>
        {before} → {after}
      </dd>
    </>
  );
}

function Trends({ shifts, names }: { shifts: Shifts; names: Record<string, string> }) {
  const { t, date, percentSign } = useI18n();
  const columns = [
    { key: "new", title: t("trendNew") },
    { key: "rising", title: t("trendRising") },
    { key: "fading", title: t("trendFading") },
  ] as const;

  return (
    <div className="trends">
      {columns.map((column) => {
        const rows = shifts.trends.filter((trend) => trend.direction === column.key);
        return (
          <section key={column.key} className={`trend-column trend-${column.key}`}>
            <h4>
              <TrendGlyph direction={column.key} />
              {column.title}
              <span className="muted num"> {rows.length}</span>
            </h4>
            {rows.length ? (
              <ul>
                {rows.map((row) => (
                  <li key={row.deck_id}>
                    <DeckIcon deckId={row.deck_id} />
                    <span className="trend-name">
                      {names[row.deck_id] ?? row.deck_id}
                      <span className="muted">{t("trendSince", { date: date(shifts.weeks[row.since]) })}</span>
                    </span>
                    <span className="trend-change num">
                      <span className="muted">{percentSign(row.before)}</span> → <strong>{percentSign(row.after)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t("noTrends")}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function TrendGlyph({ direction }: { direction: "new" | "rising" | "fading" }) {
  const d =
    direction === "new" ? "M8 3v10M3 8h10" : direction === "rising" ? "M3 12l5-6 5 6" : "M3 5l5 6 5-6";
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="trend-glyph">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * One deck's weekly share with its fitted levels. Each card has its own y
 * scale, printed as its peak: the question is *when* a deck's level moved,
 * and on a shared scale every deck but the top two would be a flat line.
 * Memoised so that hovering redraws only the crosshair props that changed.
 */
const Timeline = memo(function Timeline({
  line,
  name,
  weeks,
  flagged,
  week,
  onWeek,
}: {
  line: Shifts["timelines"][number];
  name: string;
  weeks: number;
  flagged: Set<number>;
  week: number | null;
  onWeek: (week: number | null) => void;
}) {
  const { percentSign } = useI18n();
  const values = line.share.map((v) => v ?? 0);
  const peak = Math.max(...values, ...line.levels.map((l) => l.rate), 1e-6);
  const step = SW / weeks;
  const x = (k: number) => k * step + step / 2;
  const y = (v: number) => SH - 4 - (v / peak) * (SH - 10);

  const path = line.levels
    .map((l, i) => `${i ? "L" : "M"}${l.start * step},${y(l.rate)} L${l.end * step},${y(l.rate)}`)
    .join(" ");

  const hovered = week == null ? null : line.share[week];
  const last = line.levels[line.levels.length - 1];

  return (
    <figure className="timeline">
      <figcaption>
        <DeckIcon deckId={line.deck_id} />
        <span className="timeline-name">{name}</span>
        <strong className="num">{percentSign(week == null ? last.rate : hovered ?? null)}</strong>
      </figcaption>
      <span className="timeline-peak muted num">{percentSign(peak, 1)}</span>
      <svg
        viewBox={`0 0 ${SW} ${SH}`}
        className="timeline-svg"
        role="img"
        aria-label={`${name}: ${line.levels.map((l) => percentSign(l.rate)).join(" → ")}`}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const k = Math.floor(((event.clientX - box.left) / box.width) * weeks);
          onWeek(Math.max(0, Math.min(weeks - 1, k)));
        }}
      >
        {[...flagged].map((k) => (
          <rect key={k} x={k * step} y={0} width={step} height={SH} className="flag-band" />
        ))}
        <line x1={0} x2={SW} y1={SH - 4} y2={SH - 4} className="axis-line" />
        {values.map((v, k) => (
          <circle key={k} cx={x(k)} cy={y(v)} r={1.8} className="timeline-dot" />
        ))}
        <path d={path} className="timeline-level" />
        {week != null && <line x1={x(week)} x2={x(week)} y1={0} y2={SH - 4} className="crosshair" />}
      </svg>
    </figure>
  );
});
