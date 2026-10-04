import { useQuery } from "@tanstack/react-query";
import { fetchAnalysis } from "../analysis";
import { Panel, Skeleton } from "../components/Panel";
import { PRESETS } from "../filters";
import { useI18n } from "../i18n";
import type { Mode } from "../scale";
import { Archetypes } from "./Archetypes";
import { Composition } from "./Composition";
import { CycleRing } from "./CycleRing";
import { CycleIcon, LabIcon, ShiftIcon, StrengthIcon, TriangleIcon, GroupIcon } from "./icons";
import { MetaShifts } from "./MetaShifts";
import { StrengthLadder } from "./StrengthLadder";
import { Triangles } from "./Triangles";

/**
 * The Insights view: what the offline analysis found in the metagame.
 *
 * Three questions, in the order a player would ask them - how much do
 * matchups matter here (cycles), which decks play the same role (archetypes),
 * and when did the field change (shifts). Everything comes from one static
 * file, so unlike the metagame view there is no period to choose; the strip
 * at the top says which window it read and when it ran.
 */
export function Insights({ mode }: { mode: Mode }) {
  const { t, date, count } = useI18n();
  const analysis = useQuery({ queryKey: ["analysis"], queryFn: fetchAnalysis, staleTime: Infinity });
  const data = analysis.data;

  if (analysis.isError) {
    return <p className="error">{t("insightsMissing")}</p>;
  }

  return (
    <>
      <div className="snapshot" role="note">
        <span className="snapshot-badge">
          <LabIcon />
          {t("insightsSnapshot")}
        </span>
        {data ? (
          <span className="snapshot-text">
            {t("insightsSnapshotDetail", {
              period: t(PRESETS[data.period].label),
              date: date(data.generated),
              matches: count(data.matches),
            })}
          </span>
        ) : (
          <span className="skeleton" style={{ width: 320, height: 16 }} />
        )}
      </div>

      {!data ? (
        <Panel title={t("formatTitle")}>
          <Skeleton rows={4} height={40} />
        </Panel>
      ) : (
        <>
          {data.cycles && (
            <>
              <Panel icon={<CycleIcon />} title={t("formatTitle")} note={t("formatNote", { sims: data.cycles.sims })}>
                <Composition cycles={data.cycles} />
              </Panel>

              <div className="insight-pair">
                <Panel
                  icon={<CycleIcon />}
                  title={t("ringTitle")}
                  note={t("ringNote", { share: Math.round(data.cycles.ring_captured * 100) })}
                >
                  <CycleRing cycles={data.cycles} names={data.decks} mode={mode} />
                </Panel>

                <Panel icon={<StrengthIcon />} title={t("ladderTitle")} note={t("ladderNote")}>
                  <StrengthLadder cycles={data.cycles} names={data.decks} mode={mode} />
                </Panel>
              </div>

              <Panel
                icon={<TriangleIcon />}
                title={t("trianglesTitle")}
                note={t("trianglesNote", {
                  count: data.cycles.triangle_count,
                  expected: Math.max(1, Math.ceil(data.cycles.triangle_null)),
                })}
              >
                <Triangles cycles={data.cycles} names={data.decks} />
              </Panel>
            </>
          )}

          {data.archetypes && (
            <Panel icon={<GroupIcon />} title={t("archetypesTitle")} note={t("archetypesNote")}>
              <Archetypes archetypes={data.archetypes} names={data.decks} />
            </Panel>
          )}

          {data.shifts && (
            <Panel icon={<ShiftIcon />} title={t("shiftsTitle")} note={t("shiftsNote", { z: data.shifts.flag_z })}>
              <MetaShifts shifts={data.shifts} names={data.decks} />
            </Panel>
          )}
        </>
      )}
    </>
  );
}
