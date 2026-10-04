"""The offline metagame analyses, on synthetic metagames with a known answer.

Each test plants a structure - a strength ladder, a rock-paper-scissors cycle,
two archetypes, a step in a deck's share - and checks the analysis finds it,
and, where it matters as much, that it does not find one in pure noise.

numpy and scipy live in the opt-in `analysis` dependency group, so these skip
under a plain `uv run pytest`; run them with `uv run --group analysis pytest`.
"""

from datetime import date

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("scipy")

from analysis import archetypes, cycles, shifts  # noqa: E402
from analysis.data import Matrix, build_weekly  # noqa: E402
from analysis.stats import prior_strength, resample, shrunk_rate  # noqa: E402


def make_matrix(rate, matches, rng=None, names=None):
    """A Matrix whose cells are drawn (or, without rng, set exactly) from `rate`."""
    n = len(rate)
    matches = np.full((n, n), float(matches)) if np.isscalar(matches) else matches.astype(float)
    np.fill_diagonal(matches, 0)
    if rng is None:
        points = rate * matches
    else:
        points = resample(np.zeros_like(matches), matches, rate, rng)
    ids = names or [f"d{i}" for i in range(n)]
    return Matrix("test", ids, ids, np.full(n, 1 / n), matches, points)


def ladder(strength):
    s = np.asarray(strength, dtype=float)
    return 1 / (1 + np.exp(-(s[:, None] - s[None, :])))


RPS = np.array([
    [0.5, 0.7, 0.3],
    [0.3, 0.5, 0.7],
    [0.7, 0.3, 0.5],
])


# --- stats ------------------------------------------------------------------

def test_shrinkage_keeps_the_matrix_antisymmetric_and_fills_empty_cells_at_half():
    m = make_matrix(RPS, 10)
    m.matches[0, 1] = m.matches[1, 0] = 0
    m.points[0, 1] = m.points[1, 0] = 0
    p = shrunk_rate(m.points, m.matches, 8.0)
    off = ~np.eye(3, dtype=bool)
    assert np.allclose((p + p.T)[off], 1.0)
    assert p[0, 1] == 0.5


def test_prior_strength_recovers_the_planted_spread():
    rng = np.random.default_rng(1)
    n = 40
    true = np.clip(0.5 + rng.normal(0, 0.08, (n, n)), 0.05, 0.95)
    true = np.triu(true, 1) + np.tril(1 - true.T, -1)
    m = make_matrix(true, 400, rng)
    k = prior_strength(m.points, m.matches)
    # sd 0.08 -> variance 0.0064 -> k = 0.25 / 0.0064 - 1 ~ 38
    assert 25 < k < 55


def test_resample_keeps_points_consistent_with_matches():
    rng = np.random.default_rng(2)
    m = make_matrix(RPS, 50, rng)
    off = ~np.eye(3, dtype=bool)
    assert np.allclose((m.points + m.points.T)[off], 50)


# --- cycles -----------------------------------------------------------------

def test_a_pure_ladder_has_no_cyclic_part_and_its_strengths_come_back():
    s = np.array([0.6, 0.2, 0.0, -0.3, -0.5])
    rate = ladder(s)
    logits = np.log(rate / (1 - rate))
    h = cycles.hodge(logits, np.full((5, 5), 100.0) - 100 * np.eye(5))
    assert h.cyclic_share < 1e-12
    assert np.allclose(h.strength, s - s.mean())


def test_rock_paper_scissors_is_entirely_cyclic():
    logits = np.log(RPS / (1 - RPS))
    h = cycles.hodge(logits, np.full((3, 3), 100.0) - 100 * np.eye(3))
    assert np.allclose(h.strength, 0)
    assert h.cyclic_share == pytest.approx(1.0)


def test_disc_coordinates_reproduce_who_beats_whom():
    logits = np.log(RPS / (1 - RPS))
    weights = np.full((3, 3), 1e9) - 1e9 * np.eye(3)
    d = cycles.disc(logits, weights, prior=1.0)
    x = d.coords
    cross = x[:, None, 0] * x[None, :, 1] - x[:, None, 1] * x[None, :, 0]
    # A 3-cycle is rank 2, so one eigenpair is all of it, exactly.
    assert d.captured == pytest.approx(1.0)
    assert np.allclose(cross, logits, atol=1e-6)


def test_triangles_lists_each_significant_cycle_once():
    m = make_matrix(RPS, 400)
    found = cycles.triangles(m.points, m.matches)
    assert [(i, j, k) for i, j, k, _ in found] == [(0, 1, 2)]
    assert cycles.count_triangles(m.points, m.matches) == 1


def test_null_test_separates_real_cycles_from_noise():
    rng = np.random.default_rng(3)
    s = np.linspace(-0.4, 0.4, 8)

    flat = make_matrix(ladder(s), 150, rng)
    result = cycles.fit(flat, sims=100, rng=rng)
    assert result.null.p_value > 0.05
    # All of the observed cyclic energy is accounted for as noise.
    assert result.breakdown.cyclic < 0.05

    # The same ladder with a strong rock-paper-scissors among three of its decks.
    rate = ladder(s)
    for (i, j) in [(1, 4), (4, 6), (6, 1)]:
        rate[i, j], rate[j, i] = 0.8, 0.2
    cyclic = make_matrix(rate, 150, rng)
    result = cycles.fit(cyclic, sims=100, rng=rng)
    assert result.null.p_value < 0.05
    b = result.breakdown
    assert b.cyclic > 0.05
    assert b.transitive + b.cyclic + b.noise == pytest.approx(1.0)
    assert any({i, j, k} == {1, 4, 6} for i, j, k, _ in result.triangles)


# --- archetypes -------------------------------------------------------------

def test_three_planted_archetypes_are_recovered():
    rng = np.random.default_rng(4)
    # Three styles of five decks each, in a rock-paper-scissors between styles
    # and even within one. Every deck has the same overall strength, so only
    # the shape of its matchups can tell the styles apart.
    n = 15
    style = np.array([0] * 5 + [1] * 5 + [2] * 5)
    edge = {(0, 1): 0.68, (1, 2): 0.68, (2, 0): 0.68}
    rate = np.full((n, n), 0.5)
    for i in range(n):
        for j in range(n):
            a, b = style[i], style[j]
            if (a, b) in edge:
                rate[i, j], rate[j, i] = edge[(a, b)], 1 - edge[(a, b)]
    m = make_matrix(rate, 300, rng)
    result = archetypes.fit(m, bootstrap=30, rng=rng)
    assert result.k == 3
    # Same planted style <=> same cluster.
    assert all((style[i] == style[j]) == (result.labels[i] == result.labels[j])
               for i in range(n) for j in range(n))
    assert result.stability.min() > 0.8


def test_clusters_are_numbered_by_share():
    m = make_matrix(RPS, 100)
    m.share = np.array([0.1, 0.2, 0.7])
    labels = archetypes._relabel(np.array([5, 5, 9]), m.share)
    assert labels.tolist() == [1, 1, 0]


# --- shifts -----------------------------------------------------------------

def overdispersed(rate, n, rng, phi=4.0):
    """Beta-binomial weekly counts with `phi` times the binomial variance, as tournaments give.

    Beta-binomial variance is n p (1-p) (1 + (n-1) / (a+b+1)), so a+b is
    chosen to make that factor phi.
    """
    total = (n - 1) / (phi - 1) - 1
    return rng.binomial(n.astype(int), rng.beta(rate * total, (1 - rate) * total)).astype(float)


def test_a_step_in_share_is_found_in_the_right_week():
    rng = np.random.default_rng(5)
    n = np.full(26, 5000.0)
    rate = np.where(np.arange(26) < 15, 0.03, 0.06)
    segments, _ = shifts.segment(overdispersed(rate, n, rng), n)
    assert [s.start for s in segments] == [0, 15]
    assert segments[1].rate == pytest.approx(0.06, abs=0.01)


def test_overdispersed_noise_rarely_produces_a_change_point():
    rng = np.random.default_rng(6)
    n = np.full(26, 5000.0)
    rate = np.full(26, 0.05)
    false = sum(len(shifts.segment(overdispersed(rate, n, rng), n)[0]) > 1 for _ in range(200))
    assert false / 200 < 0.1


def test_dispersion_ignores_a_single_step():
    rng = np.random.default_rng(7)
    n = np.full(26, 5000.0)
    x = rng.binomial(5000, np.where(np.arange(26) < 13, 0.03, 0.09)).astype(float)
    assert shifts.dispersion(x, n) < 3


def test_a_deck_appearing_from_nothing_is_a_new_trend():
    weeks = 20
    entries = np.zeros((2, weeks))
    entries[0] = 1000
    entries[1, 16:] = 120
    w = build_weekly_from_counts(entries)
    result = shifts.fit(w, min_entries=100)
    assert [(t.deck, t.direction, t.since) for t in result.trends] == [(1, "new", 16)]
    assert any(s.week == 16 and s.changes for s in result.weeks)


def build_weekly_from_counts(entries):
    from datetime import timedelta

    from analysis.data import Weekly
    weeks = [date(2026, 1, 5) + timedelta(weeks=k) for k in range(entries.shape[1])]
    zeros = np.zeros_like(entries)
    return Weekly(weeks, ["a", "b"], ["A", "B"], entries, entries.sum(axis=0), zeros, zeros)


# --- data -------------------------------------------------------------------

def test_build_weekly_applies_gold_rules():
    tournaments = [["big", "2026-09-02"], ["small", "2026-09-03"], ["later", "2026-09-16"]]
    pairings = (
        [["big", "a", "b", "False"]] * 8        # a beats b eight times
        + [["big", "a", "b", "True"]]           # one tie
        + [["big", "a", "a", "False"]]          # a mirror: no score
        + [["big", "a", "other", "False"]]      # vs 'other': no score
        + [["small", "a", "b", "False"]] * 3    # below min matches: dropped
        + [["later", "b", "a", "False"]] * 10
    )
    standings = [["big", "a"], ["big", "b"], ["big", "other"], ["big", ""], ["small", "a"], ["later", "b"]]
    w = build_weekly(tournaments, pairings, standings, {"a": "Deck A"}, min_matches=10)

    # Three weeks from 2026-08-31 to 2026-09-14, the empty middle one included.
    assert w.weeks == [date(2026, 8, 31), date(2026, 9, 7), date(2026, 9, 14)]
    assert w.deck_ids == ["a", "b"]
    assert w.names == ["Deck A", "b"]
    assert w.entries.tolist() == [[1, 0, 0], [1, 0, 1]]
    assert w.matches.tolist() == [[9, 0, 10], [9, 0, 10]]
    assert w.points.tolist() == [[8.5, 0, 0], [0.5, 0, 10]]
