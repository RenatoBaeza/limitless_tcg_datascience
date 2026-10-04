"""Render the three analyses as one Markdown report plus a JSON twin.

The Markdown is for reading; the JSON carries the same numbers (and the
per-deck coordinates and segments the Markdown summarises) for anything that
wants to draw them later.
"""

from datetime import date

import numpy as np
from scipy.special import expit

from analysis.archetypes import Archetypes, signature
from analysis.cycles import TRIANGLE_MIN_MATCHES, TRIANGLE_Z, Cycles
from analysis.data import Matrix, Weekly
from analysis.shifts import Shifts

SHIFT_Z = 2.0


def pct(x: float, digits: int = 1) -> str:
    return "-" if x is None or np.isnan(x) else f"{100 * x:.{digits}f}%"


def day(d: date) -> str:
    return d.strftime("%b %d")


def table(header: list[str], rows: list[list]) -> list[str]:
    out = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    out += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return out + [""]


def cluster_name(m: Matrix, a: Archetypes, c: int) -> str:
    members = np.flatnonzero(a.labels == c)
    lead = members[np.argmax(m.share[members])]
    return f"{c + 1}. {m.names[lead]}" + (f" +{len(members) - 1}" if len(members) > 1 else "")


# --- 6 ----------------------------------------------------------------------

def archetype_section(m: Matrix, a: Archetypes) -> list[str]:
    out = ["## 1. Archetypes: decks grouped by matchup profile", ""]
    out += [
        f"Each of the top {len(m.deck_ids)} decks is described by its row of the matchup matrix "
        "(shrunk log-odds against every other top deck), centred on its own average so that "
        "overall strength is factored out, and weighted by opponent meta share. Ward clustering; "
        f"the cluster count is the one with the best silhouette. Prior strength k = {a.prior:.0f} "
        "pseudo-matches at 50% per cell.",
        "",
    ]
    best = a.silhouettes[a.k]
    verdict = ("clear structure" if best >= 0.5 else
               "moderate structure" if best >= 0.25 else
               "weak structure: the archetypes overlap, so read them as tendencies, not types")
    out += table(["Clusters", "Silhouette"],
                 [[k, f"{s:.3f}" + (" **chosen**" if k == a.k else "")] for k, s in a.silhouettes.items()])
    out += [
        f"**{a.k} clusters, silhouette {best:.2f}: {verdict}.** The first two principal components "
        f"explain {pct(a.explained[0], 0)} and {pct(a.explained[1], 0)} of the profile variance.",
        "",
        "*Stability* is how often a deck lands with the rest of its cluster when every matchup is "
        "redrawn from its estimated rate (parametric bootstrap). Below about 70% the deck sits "
        "between clusters.",
        "",
    ]

    for c in range(a.k):
        members = sorted(np.flatnonzero(a.labels == c), key=lambda i: -m.share[i])
        out += [f"### Cluster {cluster_name(m, a, c)}", "",
                f"{len(members)} decks, {pct(m.share[members].sum())} combined meta share, "
                f"mean stability {pct(a.stability[members].mean(), 0)}.", ""]
        out += table(["Deck", "Share", "Stability"],
                     [[m.names[i], pct(m.share[i], 2), pct(a.stability[i], 0)] for i in members])
        good, bad = signature(m, a, c)
        if good:
            out += ["Best against: " + ", ".join(f"{m.names[j]} ({pct(r)}, {k} m)" for j, r, k in good) + "  ",
                    "Worst against: " + ", ".join(f"{m.names[j]} ({pct(r)}, {k} m)" for j, r, k in bad), ""]

    out += ["### Cluster vs cluster", "",
            "Pooled score rate of the row cluster against the column cluster, from raw match counts "
            "(mirrors excluded, so the diagonal is matches between different decks of the same cluster).", ""]
    header = ["vs"] + [str(c + 1) for c in range(a.k)]
    rows = [[cluster_name(m, a, r)] + [f"{pct(a.cluster_matrix[r, c])} ({int(a.cluster_matches[r, c])})"
                                       for c in range(a.k)] for r in range(a.k)]
    return out + table(header, rows)


# --- 7 ----------------------------------------------------------------------

def cycles_section(m: Matrix, c: Cycles) -> list[str]:
    h, null, b = c.hodge, c.null, c.breakdown
    out = ["## 2. Cycles: how much of the format is rock-paper-scissors", "",
           "The matchup matrix (log-odds, weighted by matches) splits exactly into a *transitive* part, "
           "one strength per deck where the stronger deck is favoured, and a *cyclic* part, "
           "A beats B beats C beats A. Sampling noise lands in the cyclic part too, since one cell's "
           f"error cannot be explained by strengths, so {null.sims} metagames are simulated with the "
           "same decks, match counts and strengths but no cycles at all, and the cyclic energy they "
           "produce from noise alone is taken off.", ""]
    out += table(["Part", "Share of the matrix"], [
        ["Transitive (deck strength)", pct(b.transitive)],
        ["**Cyclic (real rock-paper-scissors)**", f"**{pct(b.cyclic)}**"],
        ["Sampling noise", pct(b.noise)],
    ])
    if null.p_value < 0.05:
        real = b.cyclic / max(b.cyclic + b.transitive, 1e-12)
        out += [f"Cycles are real (p = {null.p_value:.3f}, the smallest {null.sims} simulations can show). "
                f"Of the structure that is not noise, **{pct(real, 0)} is rock-paper-scissors and "
                f"{pct(1 - real, 0)} is deck strength**. "
                + ("This format is decided far more by matchups than by raw deck quality: which deck is "
                   "best depends on the field you expect." if real >= 0.5 else
                   "Deck strength dominates, but there is real room for reading the field."), ""]
    else:
        out += [f"No evidence of cycles beyond noise (p = {null.p_value:.3f}): the matrix is consistent "
                "with a strength ladder plus sampling error, so the strongest deck is simply the pick.", ""]

    order = np.argsort(-h.strength)
    out += ["### Strength ladder", "",
            "*Strength* is the transitive part alone, as the expected score against a deck of average "
            "strength. Pairings are random, so each deck meets opponents roughly in proportion to how "
            "much they are played, and its strength therefore comes out close to its score against "
            "the current field. The cyclic part is what that score would gain or lose if the field "
            "changed, which is exactly the room for metagaming.", ""]
    out += table(["#", "Deck", "Share", "Strength", "Matches vs top decks"], [
        [r + 1, m.names[i], pct(m.share[i], 2), pct(expit(h.strength[i])), int(m.matches[i].sum())]
        for r, i in enumerate(order)
    ])

    radius = np.hypot(c.disc.coords[:, 0], c.disc.coords[:, 1])
    angle = np.degrees(np.arctan2(c.disc.coords[:, 1], c.disc.coords[:, 0])) % 360
    on_disc = sorted([i for i in np.argsort(-radius)[:12]], key=lambda i: angle[i])
    out += ["### The main cycle", "",
            f"The largest single rock-paper-scissors pattern holds {pct(c.disc.captured, 0)} of the "
            "cyclic part. Placing each deck on a circle by it, a deck tends to beat the decks just "
            "after it in this list and lose to the ones just before it (the list wraps around). "
            "*Pull* is how strongly the deck takes part; only the 12 strongest are shown.", ""]
    out += table(["Angle", "Deck", "Pull"],
                 [[f"{angle[i]:.0f}°", m.names[i], f"{radius[i]:.2f}"] for i in on_disc])

    rate = m.points / np.maximum(m.matches, 1)
    null_tri = float(null.triangles.mean()) if null.sims else float("nan")
    out += ["### Significant triangles", "",
            f"Three decks where each beats the next with every edge at z >= {TRIANGLE_Z:g} and "
            f"{TRIANGLE_MIN_MATCHES}+ matches. {len(c.triangles)} found; noise alone produces "
            f"{null_tri:.1f} on average (p = {null.triangle_p:.3f}).", ""]
    if c.triangles:
        out += table(["A > B", "B > C", "C > A", "Weakest z"], [
            [f"{m.names[i]} > {m.names[j]} {pct(rate[i, j], 0)} ({int(m.matches[i, j])})",
             f"{m.names[j]} > {m.names[k]} {pct(rate[j, k], 0)} ({int(m.matches[j, k])})",
             f"{m.names[k]} > {m.names[i]} {pct(rate[k, i], 0)} ({int(m.matches[k, i])})",
             f"{z:.1f}"]
            for i, j, k, z in c.triangles[:15]
        ])
    return out


# --- 8 ----------------------------------------------------------------------

def shifts_section(s: Shifts, recent: int) -> list[str]:
    w: Weekly = s.weekly
    out = ["## 3. Meta shifts: when the metagame moved", "",
           f"Weekly series for the {len(s.decks)} decks with enough entries, {day(w.weeks[0])} to "
           f"{day(w.weeks[-1])} ({len(w.weeks)} weeks, weeks start Monday). Each deck's meta share and "
           "score rate are fitted as piecewise-constant levels with an overdispersion-corrected "
           "binomial model; a change point is where the level jumps. On simulated noise about 7% of "
           "series get one spurious change, so treat a lone change with |z| under 4 with suspicion.", ""]

    out += ["### Week by week", "",
            "*Divergence* is how far the whole share distribution moved from the previous week "
            "(Jensen-Shannon, millibits); *z* is relative to a typical week. A handful of decks change "
            f"level in an ordinary week; ⚑ marks the weeks with z >= {SHIFT_Z:g}, where the whole "
            "distribution jumped, the signature of a set release, a rotation or a ban.", ""]
    rows = []
    for ws in s.weeks:
        movers = ", ".join(
            f"{w.names[ch.deck]} {pct(ch.before)}→{pct(ch.after)}" for ch in ws.changes[:3])
        flag = " **⚑**" if ws.z >= SHIFT_Z else ""
        rows.append([day(w.weeks[ws.week]) + flag, f"{1000 * ws.divergence:.1f}", f"{ws.z:+.1f}",
                     len(ws.changes), movers or "-"])
    out += table(["Week of", "Divergence", "z", "Share changes", "Biggest"], rows)

    out += ["### Rising, new and fading", "",
            f"Decks whose current share level began in the last {recent} weeks and is at least 1.5x "
            "above or below the level before it.", ""]
    if s.trends:
        out += table(["Deck", "Trend", "Since", "Share before", "Share now"], [
            [w.names[t.deck], t.direction, day(w.weeks[t.since]), pct(t.before, 2), pct(t.after, 2)]
            for t in s.trends])
    else:
        out += ["None.", ""]

    cutoff = len(w.weeks) - recent
    for metric, title in (("share", "Meta share"), ("score", "Score rate")):
        recent_changes = sorted((c for c in s.changes if c.metric == metric and c.week >= cutoff),
                                key=lambda c: -abs(c.z))[:20]
        out += [f"### {title} change points, last {recent} weeks", ""]
        if recent_changes:
            out += table(["Deck", "Week of", "Before", "After", "z"], [
                [w.names[c.deck], day(w.weeks[c.week]), pct(c.before, 2), pct(c.after, 2), f"{c.z:+.1f}"]
                for c in recent_changes])
        else:
            out += ["None.", ""]

    top = sorted(s.decks, key=lambda i: -w.entries[i].sum())[:20]
    out += ["### Share timelines, 20 most-played decks", "",
            "Each fitted level as *first week - last week: share*.", ""]
    out += table(["Deck", "Levels"], [
        [w.names[i], " → ".join(
            f"{day(w.weeks[g.start])}–{day(w.weeks[g.end - 1])}: {pct(g.rate, 1)}" for g in s.share[i])]
        for i in top])
    return out


def markdown(m: Matrix | None, a: Archetypes | None, c: Cycles | None,
             s: Shifts | None, recent: int, generated: date) -> str:
    out = ["# PKTCG DuelMeta: metagame analysis", "",
           f"Generated {generated.isoformat()} by `scripts/analyze_meta.py`."]
    if m is not None:
        out += [f"Archetypes and cycles read gold's `{m.period}` period, top {len(m.deck_ids)} decks "
                f"({int(m.matches.sum() / 2)} matches between them)."]
    if s is not None:
        out += ["Meta shifts read silver, re-aggregated by week under gold's rules."]
    out += [""]
    if a is not None:
        out += archetype_section(m, a)
    if c is not None:
        out += cycles_section(m, c)
    if s is not None:
        out += shifts_section(s, recent)
    return "\n".join(out)


RING_SIZE = 12
TRIANGLES_SHOWN = 12
TIMELINES_SHOWN = 15  # three full rows at the client's widest layout


def _r(x: float, digits: int = 4) -> float | None:
    """A JSON-safe rounded float: NaN becomes null, and the file stays small."""
    return None if x is None or np.isnan(x) else round(float(x), digits)


def as_json(m: Matrix | None, a: Archetypes | None, c: Cycles | None, s: Shifts | None,
            generated: date) -> dict:
    """The numbers the client's Insights view draws, in the shape it draws them.

    Deck names live once, in `decks`; everything else refers to a deck by id.
    Typed on the client in client/src/analysis.ts - change both together.
    """
    names: dict[str, str] = {}
    out: dict = {"generated": generated.isoformat(), "decks": names}

    if m is not None:
        names.update(zip(m.deck_ids, m.names))
        rate = m.points / np.maximum(m.matches, 1)
        out["period"] = m.period
        out["matches"] = int(m.matches.sum() / 2)

    if m is not None and a is not None:
        cluster = lambda js: [{"deck_id": m.deck_ids[j], "rate": _r(r), "matches": n}  # noqa: E731
                              for j, r, n in js]
        signatures = [signature(m, a, k) for k in range(a.k)]
        out["archetypes"] = {
            "k": a.k,
            "silhouette": _r(a.silhouettes[a.k], 3),
            "explained": [_r(a.explained[0], 3), _r(a.explained[1], 3)],
            "decks": [{"deck_id": m.deck_ids[i], "share": _r(m.share[i]), "cluster": int(a.labels[i]),
                       "stability": _r(a.stability[i], 3), "x": _r(a.coords[i, 0]), "y": _r(a.coords[i, 1])}
                      for i in range(len(m.deck_ids))],
            "clusters": [{
                "share": _r(m.share[a.labels == k].sum()),
                "stability": _r(a.stability[a.labels == k].mean(), 3),
                "best": cluster(signatures[k][0]),
                "worst": cluster(signatures[k][1]),
            } for k in range(a.k)],
            "cross": [[{"rate": _r(a.cluster_matrix[r, k]), "matches": int(a.cluster_matches[r, k])}
                       for k in range(a.k)] for r in range(a.k)],
        }

    if m is not None and c is not None:
        radius = np.hypot(c.disc.coords[:, 0], c.disc.coords[:, 1])
        angle = np.degrees(np.arctan2(c.disc.coords[:, 1], c.disc.coords[:, 0])) % 360
        ring = sorted(np.argsort(-radius)[:RING_SIZE], key=lambda i: angle[i])
        out["cycles"] = {
            "transitive": _r(c.breakdown.transitive),
            "cyclic": _r(c.breakdown.cyclic),
            "noise": _r(c.breakdown.noise),
            "p_value": _r(c.null.p_value),
            "sims": c.null.sims,
            "ring_captured": _r(c.disc.captured, 3),
            "ladder": [{"deck_id": m.deck_ids[i], "share": _r(m.share[i]),
                        "strength": _r(expit(c.hodge.strength[i])), "matches": int(m.matches[i].sum())}
                       for i in np.argsort(-c.hodge.strength)],
            "ring": [{"deck_id": m.deck_ids[i], "angle": _r(angle[i], 1), "pull": _r(radius[i], 3)}
                     for i in ring],
            # Observed results between the ring's decks, for the hover that
            # shows who each one beats. Both directions, so no flipping.
            "ring_pairs": [{"a": m.deck_ids[i], "b": m.deck_ids[j], "rate": _r(rate[i, j]),
                            "matches": int(m.matches[i, j])}
                           for i in ring for j in ring if i != j and m.matches[i, j] > 0],
            "triangle_count": len(c.triangles),
            "triangle_null": _r(float(c.null.triangles.mean()) if c.null.sims else 0.0, 2),
            "triangles": [{
                "decks": [m.deck_ids[i], m.deck_ids[j], m.deck_ids[k]],
                "rates": [_r(rate[i, j]), _r(rate[j, k]), _r(rate[k, i])],
                "matches": [int(m.matches[i, j]), int(m.matches[j, k]), int(m.matches[k, i])],
                "z": _r(z, 2),
            } for i, j, k, z in c.triangles[:TRIANGLES_SHOWN]],
        }

    if s is not None:
        w = s.weekly
        names.update({w.deck_ids[i]: w.names[i] for i in s.decks if w.deck_ids[i] not in names})
        with np.errstate(invalid="ignore", divide="ignore"):
            share = np.where(w.total_entries > 0, w.entries / w.total_entries, np.nan)
        top = sorted(s.decks, key=lambda i: -w.entries[i].sum())[:TIMELINES_SHOWN]
        out["shifts"] = {
            "weeks": [d.isoformat() for d in w.weeks],
            "flag_z": SHIFT_Z,
            "weekly": [{
                "week": ws.week,
                "divergence": _r(ws.divergence, 5),
                "z": _r(ws.z, 2),
                "changes": len(ws.changes),
                "movers": [{"deck_id": w.deck_ids[ch.deck], "before": _r(ch.before), "after": _r(ch.after)}
                           for ch in ws.changes[:3]],
            } for ws in s.weeks],
            "trends": [{"deck_id": w.deck_ids[t.deck], "direction": t.direction, "since": t.since,
                        "before": _r(t.before), "after": _r(t.after)} for t in s.trends],
            "timelines": [{
                "deck_id": w.deck_ids[i],
                "share": [_r(x) for x in share[i]],
                "levels": [{"start": g.start, "end": g.end, "rate": _r(g.rate)} for g in s.share[i]],
            } for i in top],
        }
    return out
