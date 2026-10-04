"""Statistical pieces the analyses share.

The one idea underneath all of them: a matchup cell is a binomial sample, and
a 3-match cell at 100% is mostly noise. Rather than drop thin cells behind a
cutoff (the matrix deliberately has none), every analysis reads cells through
`shrunk_rate`, which pulls each one toward 50% by an amount the data itself
chooses.
"""

import numpy as np
from scipy.special import logit


def prior_strength(points: np.ndarray, matches: np.ndarray, min_matches: int = 20) -> float:
    """Empirical-Bayes strength k of a Beta(k/2, k/2) prior on matchup rates.

    An observed rate is its true rate plus binomial noise, so the spread of
    true rates is the observed spread less the average noise - method of
    moments, over the cells with enough matches to say anything. k is then the
    Beta whose variance is that spread: the number of pseudo-matches at 50%
    every cell is pulled toward. Clipped so a degenerate input (every cell at
    50%, or a single cell) cannot pin the prior at either extreme.
    """
    upper = np.triu(matches >= min_matches, k=1)
    n = matches[upper]
    if n.size < 2:
        return 20.0
    p = points[upper] / n
    spread = np.mean((p - 0.5) ** 2) - np.mean(p * (1 - p) / n)
    if spread <= 0:
        return 500.0
    return float(np.clip(0.25 / spread - 1, 1.0, 500.0))


def shrunk_rate(points: np.ndarray, matches: np.ndarray, k: float) -> np.ndarray:
    """Posterior-mean score rate: each cell's record plus k/2 wins and k/2 losses.

    Symmetric about 50%, so a matrix that was antisymmetric (p_ij = 1 - p_ji)
    stays that way, and an empty cell comes out at exactly 50%.
    """
    return (points + k / 2) / (matches + k)


def shrunk_logit(points: np.ndarray, matches: np.ndarray, k: float) -> np.ndarray:
    """`shrunk_rate` on the log-odds scale, with a zero (mirror) diagonal."""
    out = logit(shrunk_rate(points, matches, k))
    np.fill_diagonal(out, 0.0)
    return out


def edge_z(points: np.ndarray, matches: np.ndarray) -> np.ndarray:
    """How many standard errors each cell's rate sits from 50%.

    Uses the binomial variance at 50%; ties make the true variance smaller, so
    this errs toward calling a cell inconclusive. Zero where there are no matches.
    """
    with np.errstate(invalid="ignore", divide="ignore"):
        z = (points - matches / 2) / np.sqrt(matches / 4)
    return np.where(matches > 0, z, 0.0)


def resample(points: np.ndarray, matches: np.ndarray, rate: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """A parametric bootstrap of `points`: each cell redrawn from Binomial(n, rate).

    Draws the upper triangle and mirrors it, so the result keeps
    `points + points.T == matches`. Ties are not modelled - a resampled cell is
    all wins and losses - which slightly overstates the noise.
    """
    n = matches.astype(np.int64)
    draw = rng.binomial(np.triu(n, k=1), np.clip(rate, 0, 1)).astype(float)
    return draw + (np.triu(matches, k=1) - draw).T
