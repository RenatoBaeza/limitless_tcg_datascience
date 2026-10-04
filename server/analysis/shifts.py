"""Find the weeks the metagame moved: per-deck change points and meta-wide shifts.

Each deck gets two weekly series, meta share (its entries out of every known
deck's entries) and score rate (its points out of its non-mirror matches). A
series is modelled as piecewise constant, a binomial rate that holds for a
run of weeks and then jumps, and `segment` finds the jumps by exact optimal
partitioning: the split that minimises total deviance plus a penalty per
segment. With ~26 weeks the O(T^2) dynamic programme is instant, so there is
no need for the approximate searches (PELT, binary segmentation) that matter
on long series.

Two things keep it from calling every wobble a change:

- **Overdispersion.** Entries arrive by tournament, and tournaments differ
  (a regional with one dominant deck, a store with six players), so weekly
  counts vary far more than a binomial says. A plain binomial deviance would
  find a change point in almost every week. `dispersion` measures the excess
  from week-to-week differences, using the median so that a real step in the
  series barely moves it, and the deviance is divided by it: a quasi-binomial.
- **The penalty.** Each segment costs `penalty * log(T)` deviance units
  (BIC-like, but stricter than BIC's 2 * log(T), since ~60 decks are tested at
  once). At the default of 3, a lone jump has to clear roughly 3 standard errors.

On top of the per-deck changes, `meta_shifts` marks the weeks where many decks
changed together and the share distribution moved most (a Jensen-Shannon
divergence between consecutive weeks) - the signature of a set release or a
ban rather than one deck's rise.
"""

from dataclasses import dataclass, field

import numpy as np
from scipy.special import xlogy

from analysis.data import Weekly

MEDIAN_CHI2_1 = 0.454936  # median of a chi-square with one degree of freedom


@dataclass
class Segment:
    start: int      # first week index
    end: int        # one past the last week index
    successes: float
    trials: float

    @property
    def rate(self) -> float:
        return self.successes / self.trials if self.trials > 0 else float("nan")


@dataclass
class Change:
    deck: int
    metric: str     # 'share' or 'score'
    week: int       # first week of the new level
    before: float
    after: float
    z: float


@dataclass
class Trend:
    deck: int
    direction: str  # 'rising', 'fading' or 'new'
    since: int      # week the current level began
    before: float
    after: float


@dataclass
class WeekShift:
    week: int
    divergence: float   # Jensen-Shannon, in bits, from the week before
    z: float            # robust z of that divergence across the window
    changes: list[Change] = field(default_factory=list)


@dataclass
class Shifts:
    weekly: Weekly
    decks: list[int]
    share: dict[int, list[Segment]]
    score: dict[int, list[Segment]]
    changes: list[Change]
    trends: list[Trend]
    weeks: list[WeekShift]


def dispersion(x: np.ndarray, n: np.ndarray) -> float:
    """Quasi-binomial dispersion phi (>= 1) from consecutive-week differences.

    Under a constant rate, the standardised difference between two weeks is
    N(0, phi) and its square phi * chi2(1); the median of the squares over the
    median of chi2(1) estimates phi. Differences across a real change point are
    a handful of outliers out of ~25, which the median ignores.
    """
    keep = n > 0
    xs, ns = x[keep], n[keep]
    if len(xs) < 4 or ns.sum() <= 0:
        return 1.0
    p = xs.sum() / ns.sum()
    if p <= 0 or p >= 1:
        return 1.0
    rates = xs / ns
    d = np.diff(rates) / np.sqrt(p * (1 - p) * (1 / ns[1:] + 1 / ns[:-1]))
    return max(1.0, float(np.median(d ** 2) / MEDIAN_CHI2_1))


def segment(x: np.ndarray, n: np.ndarray, penalty: float = 3.0, min_size: int = 2,
            phi: float | None = None) -> tuple[list[Segment], float]:
    """Optimal piecewise-constant binomial segmentation of one weekly series.

    Returns the segments in order and the dispersion the deviance was scaled by.
    `min_size` keeps a single odd week from becoming its own segment.
    """
    phi = dispersion(x, n) if phi is None else phi
    weeks = len(x)
    cx = np.concatenate([[0.0], np.cumsum(x)])
    cn = np.concatenate([[0.0], np.cumsum(n)])

    def cost(a: int, b: int) -> float:
        s, t = cx[b] - cx[a], cn[b] - cn[a]
        if t <= 0:
            return 0.0
        p = s / t
        return float(-2 * (xlogy(s, p) + xlogy(t - s, 1 - p)) / phi)

    if weeks < 2 * min_size:
        return [Segment(0, weeks, cx[-1], cn[-1])], phi

    beta = penalty * np.log(weeks)
    best = np.full(weeks + 1, np.inf)
    best[0] = -beta
    prev = np.zeros(weeks + 1, dtype=int)
    for b in range(min_size, weeks + 1):
        for a in range(0, b - min_size + 1):
            if not np.isfinite(best[a]):
                continue
            c = best[a] + cost(a, b) + beta
            if c < best[b]:
                best[b], prev[b] = c, a

    bounds = [weeks]
    while bounds[-1] > 0:
        bounds.append(prev[bounds[-1]])
    bounds.reverse()
    segments = [Segment(a, b, cx[b] - cx[a], cn[b] - cn[a]) for a, b in zip(bounds, bounds[1:])]
    return segments, phi


def _changes(deck: int, metric: str, segments: list[Segment], phi: float) -> list[Change]:
    out = []
    for left, right in zip(segments, segments[1:]):
        p1, p2 = left.rate, right.rate
        pooled = (left.successes + right.successes) / (left.trials + right.trials)
        se = np.sqrt(phi * pooled * (1 - pooled) * (1 / left.trials + 1 / right.trials))
        out.append(Change(deck, metric, right.start, p1, p2, float((p2 - p1) / se) if se > 0 else 0.0))
    return out


def _js(p: np.ndarray, q: np.ndarray) -> float:
    m = (p + q) / 2
    kl = lambda a: float(np.sum(xlogy(a, a) - xlogy(a, m))) / np.log(2)  # noqa: E731
    return (kl(p) + kl(q)) / 2


def meta_shifts(w: Weekly, changes: list[Change]) -> list[WeekShift]:
    """Week-on-week divergence of the whole share distribution, with the changes landing that week."""
    with np.errstate(invalid="ignore", divide="ignore"):
        dist = np.where(w.total_entries > 0, w.entries / w.total_entries, 0.0)
    out = []
    for k in range(1, len(w.weeks)):
        week_changes = sorted((c for c in changes if c.week == k and c.metric == "share"),
                              key=lambda c: -abs(c.z))
        out.append(WeekShift(k, _js(dist[:, k - 1], dist[:, k]), 0.0, week_changes))

    values = np.array([s.divergence for s in out])
    if len(values):
        median = np.median(values)
        mad = 1.4826 * np.median(np.abs(values - median)) or 1e-12
        for s in out:
            s.z = float((s.divergence - median) / mad)
    return out


def fit(w: Weekly, min_entries: int = 300, penalty: float = 3.0, recent: int = 6,
        min_ratio: float = 1.5) -> Shifts:
    """Segment every deck with at least `min_entries` entries across the window.

    A trend is a deck whose current share level began in the last `recent`
    weeks and sits at least `min_ratio` times above (rising) or below (fading)
    the level before it; 'new' is a rise from a level of zero.
    """
    decks = [i for i in range(len(w.deck_ids)) if w.entries[i].sum() >= min_entries]
    share: dict[int, list[Segment]] = {}
    score: dict[int, list[Segment]] = {}
    changes: list[Change] = []
    trends: list[Trend] = []
    last_week = len(w.weeks)

    for i in decks:
        share[i], phi_share = segment(w.entries[i], w.total_entries, penalty)
        score[i], phi_score = segment(w.points[i], w.matches[i], penalty)
        changes += _changes(i, "share", share[i], phi_share)
        changes += _changes(i, "score", score[i], phi_score)

        if len(share[i]) >= 2 and share[i][-1].start >= last_week - recent:
            before, after = share[i][-2].rate, share[i][-1].rate
            if before == 0 and after > 0:
                trends.append(Trend(i, "new", share[i][-1].start, before, after))
            elif before > 0 and after / before >= min_ratio:
                trends.append(Trend(i, "rising", share[i][-1].start, before, after))
            elif after > 0 and before / after >= min_ratio:
                trends.append(Trend(i, "fading", share[i][-1].start, before, after))
            elif after == 0:
                trends.append(Trend(i, "fading", share[i][-1].start, before, after))

    changes.sort(key=lambda c: (-c.week, -abs(c.z)))
    trends.sort(key=lambda t: -abs(np.log((t.after + 1e-4) / (t.before + 1e-4))))
    return Shifts(w, decks, share, score, changes, trends, meta_shifts(w, changes))
