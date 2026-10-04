import type { CSSProperties } from "react";
import type { Cycles } from "../analysis";
import { useCountUp } from "../fx/motion";
import { useI18n } from "../i18n";

/**
 * The format in one number: how much of what decides a matchup is
 * rock-paper-scissors rather than deck strength.
 *
 * The headline leaves noise out of the denominator - noise is not something
 * that decides matchups, it is what the data cannot tell apart - and the bar
 * beneath shows all three parts, so the reader can see what was set aside.
 * One part is the story, so it alone takes the series colour; the other two
 * stay neutral, and every segment is labelled directly rather than keyed.
 */
export function Composition({ cycles }: { cycles: Cycles }) {
  const { t, percentSign } = useI18n();
  const signal = cycles.cyclic + cycles.transitive;
  const headline = signal > 0 ? cycles.cyclic / signal : 0;
  const shown = useCountUp(Math.round(headline * 100), 1400);
  const significant = cycles.p_value < 0.05;

  const parts = [
    { key: "cyclic", label: t("partCyclic"), value: cycles.cyclic },
    { key: "transitive", label: t("partStrength"), value: cycles.transitive },
    { key: "noise", label: t("partNoise"), value: cycles.noise },
  ];

  const verdict = !significant
    ? t("formatVerdictNone")
    : headline >= 0.5
      ? t("formatVerdictCyclic")
      : t("formatVerdictStrength");

  return (
    <div className="composition">
      <div className="composition-hero">
        <strong className="hero-number num">{significant ? `${Math.round(shown)}%` : "—"}</strong>
        <div>
          <p className="hero-label">{t("formatHeadline")}</p>
          <p className="hero-verdict">{verdict}</p>
        </div>
      </div>

      <div className="composition-bar" role="img" aria-label={parts.map((p) => `${p.label} ${percentSign(p.value, 0)}`).join(", ")}>
        {parts.map((part, i) => (
          <span
            key={part.key}
            className={`segment segment-${part.key}`}
            style={{ flexGrow: part.value, "--i": i } as CSSProperties}
          />
        ))}
      </div>

      <div className="composition-labels" aria-hidden="true">
        {parts.map((part) => (
          <span key={part.key} className={`composition-label label-${part.key}`} style={{ flexGrow: part.value }}>
            <strong className="num">{percentSign(part.value, 0)}</strong> {part.label}
          </span>
        ))}
      </div>
    </div>
  );
}
