"""Cluster decks by how they play against the field, not by what they contain.

A deck's feature vector is its row of the matchup matrix: its shrunk log-odds
against each other top deck. Two decks that beat and lose to the same things
play the same role in the metagame whatever their card lists, so that row is
the archetype fingerprint.

Two choices shape the result:

- Rows are centred on the deck's own average, so the clustering sees the
  *shape* of a deck's matchups and not its overall strength. Without it the
  first split is simply strong decks vs weak decks, which cycles.hodge
  already measures directly.
- Columns are weighted by the square root of the opponent's meta share, so a
  difference against the deck everyone plays counts for more than one against
  a deck seen twice.

Ward linkage, the cluster count chosen by silhouette unless one is given,
and a parametric bootstrap over the matches to say how stable each deck's
assignment is. The silhouette is reported as-is: if the metagame has no clean
archetype structure, a low score is the finding.
"""

from dataclasses import dataclass

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import pdist, squareform

from analysis.data import Matrix
from analysis.stats import prior_strength, resample, shrunk_logit, shrunk_rate

MAX_CLUSTERS = 8


@dataclass
class Archetypes:
    k: int
    prior: float
    labels: np.ndarray          # cluster per deck, 0-based, cluster 0 holds the most share
    silhouettes: dict[int, float]
    stability: np.ndarray       # per deck: how often it lands with its own cluster
    coords: np.ndarray          # (n, 2) principal-component coordinates
    explained: tuple[float, float]
    cluster_matrix: np.ndarray  # pooled score rate, cluster vs cluster
    cluster_matches: np.ndarray


def profiles(m: Matrix, prior: float) -> np.ndarray:
    """Each deck's centred, share-weighted matchup row."""
    logits = shrunk_logit(m.points, m.matches, prior)
    w = np.clip(m.share, 1e-6, None)
    others = np.tile(w, (len(w), 1))
    np.fill_diagonal(others, 0.0)
    centre = (logits * others).sum(axis=1) / others.sum(axis=1)
    centred = logits - centre[:, None]
    np.fill_diagonal(centred, 0.0)
    return centred * np.sqrt(w / w.sum())[None, :]


def silhouette(x: np.ndarray, labels: np.ndarray) -> float:
    """Mean silhouette width, Euclidean. Singleton clusters score 0, by convention."""
    d = squareform(pdist(x))
    scores = np.zeros(len(x))
    for i in range(len(x)):
        own = labels == labels[i]
        if own.sum() <= 1:
            continue
        a = d[i, own].sum() / (own.sum() - 1)
        b = min(d[i, labels == c].mean() for c in np.unique(labels) if c != labels[i])
        scores[i] = (b - a) / max(a, b)
    return float(scores.mean())


def _cut(x: np.ndarray, k: int) -> np.ndarray:
    return fcluster(linkage(x, method="ward"), k, criterion="maxclust") - 1


def _relabel(labels: np.ndarray, share: np.ndarray) -> np.ndarray:
    """Renumber clusters by total meta share, biggest first, so 0 is the main one."""
    order = sorted(np.unique(labels), key=lambda c: -share[labels == c].sum())
    mapping = {old: new for new, old in enumerate(order)}
    return np.array([mapping[c] for c in labels])


def pooled(m: Matrix, labels: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """Cluster-vs-cluster score rate from the raw counts, mirrors already out."""
    points = np.zeros((k, k))
    matches = np.zeros((k, k))
    for a in range(k):
        for b in range(k):
            block = np.ix_(labels == a, labels == b)
            points[a, b] = m.points[block].sum()
            matches[a, b] = m.matches[block].sum()
    with np.errstate(invalid="ignore", divide="ignore"):
        rate = np.where(matches > 0, points / matches, np.nan)
    return rate, matches


def fit(
    m: Matrix,
    k: int | None = None,
    bootstrap: int = 200,
    rng: np.random.Generator | None = None,
) -> Archetypes:
    rng = rng or np.random.default_rng(0)
    n = len(m.deck_ids)
    if n < 3:
        raise ValueError("need at least three decks to cluster")

    prior = prior_strength(m.points, m.matches)
    x = profiles(m, prior)

    candidates = range(2, min(MAX_CLUSTERS, n - 1) + 1)
    silhouettes = {c: silhouette(x, _cut(x, c)) for c in candidates}
    if k is None:
        k = max(silhouettes, key=silhouettes.get)
    labels = _relabel(_cut(x, k), m.share)

    # How often each pair of decks shares a cluster when the matches are
    # redrawn from the shrunk rates. A deck's stability is its average
    # co-assignment with the rest of its own cluster.
    together = np.zeros((n, n))
    rate = shrunk_rate(m.points, m.matches, prior)
    for _ in range(bootstrap):
        boot = Matrix(m.period, m.deck_ids, m.names, m.share, m.matches,
                      resample(m.points, m.matches, rate, rng))
        b = _cut(profiles(boot, prior), k)
        together += b[:, None] == b[None, :]
    together /= max(bootstrap, 1)
    stability = np.ones(n)
    for i in range(n):
        mates = (labels == labels[i]) & (np.arange(n) != i)
        if bootstrap and mates.any():
            stability[i] = together[i, mates].mean()

    centred = x - x.mean(axis=0)
    _, s, vt = np.linalg.svd(centred, full_matrices=False)
    coords = centred @ vt[:2].T
    variance = s ** 2 / max((s ** 2).sum(), 1e-12)

    cluster_matrix, cluster_matches = pooled(m, labels, k)
    return Archetypes(
        k=k,
        prior=prior,
        labels=labels,
        silhouettes=silhouettes,
        stability=stability,
        coords=coords,
        explained=(float(variance[0]), float(variance[1]) if len(variance) > 1 else 0.0),
        cluster_matrix=cluster_matrix,
        cluster_matches=cluster_matches,
    )


def signature(m: Matrix, a: Archetypes, cluster: int, size: int = 3, min_matches: int = 50) -> tuple[list, list]:
    """The opponents a cluster does best and worst against, pooled over its members.

    Returned as (deck index, score rate, matches) lists, best first and worst
    first. Ranked on rates shrunk with the same prior as everything else, so a
    thin pairing cannot top the list; the rate returned is the raw one.
    """
    members = a.labels == cluster
    points = m.points[members].sum(axis=0)
    matches = m.matches[members].sum(axis=0)
    rate = shrunk_rate(points, matches, a.prior)
    pool = [j for j in range(len(m.deck_ids)) if matches[j] >= min_matches and not members[j]]
    ranked = sorted(pool, key=lambda j: -rate[j])
    row = lambda j: (j, float(points[j] / matches[j]), int(matches[j]))  # noqa: E731
    return [row(j) for j in ranked[:size]], [row(j) for j in ranked[::-1][:size]]
