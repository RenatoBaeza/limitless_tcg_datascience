"""How much of the metagame is rock-paper-scissors, and where the cycles are.

Any antisymmetric matchup matrix splits exactly into two parts (a Hodge
decomposition, as in HodgeRank and Balduzzi et al., "Re-evaluating
Evaluation", 2018):

    transitive   L_ij = r_i - r_j. One strength per deck, and the stronger
                 deck is favoured. A purely transitive format has a best deck.
    cyclic       what is left: A beats B beats C beats A. A purely cyclic
                 format has no best deck, only good answers to the field.

`hodge` fits r by weighted least squares on the log-odds of the shrunk
matrix (weighted by matches, so a thick cell counts for more) and reports how
much of the matrix's weighted energy each part holds.

Noise is cyclic too - a random error in one cell cannot be explained by
strengths - so the raw cyclic share overstates real cycles. `null_test`
simulates purely transitive metagames with the same decks, the same match
counts and the fitted strengths, and the cyclic share they produce from noise
alone is the floor the real one has to clear.

The cyclic part is then described two ways: as the disc game its largest
eigenpair spans (each deck a point on a plane, and i beats j when j sits
counter-clockwise of i - see `disc`), and as the explicit triangles where all
three edges are individually significant (`triangles`).
"""

from dataclasses import dataclass

import numpy as np
from scipy.special import expit

from analysis.data import Matrix
from analysis.stats import edge_z, prior_strength, resample, shrunk_logit

TRIANGLE_Z = 2.0
TRIANGLE_MIN_MATCHES = 30


@dataclass
class Hodge:
    strength: np.ndarray    # r: log-odds strength, mean zero
    transitive: np.ndarray  # r_i - r_j
    cyclic: np.ndarray      # L - transitive, on observed cells only
    energy: float           # weighted sum of squares of the whole matrix
    cyclic_energy: float    # ... of the cyclic part; the rest is transitive

    @property
    def cyclic_share(self) -> float:
        return self.cyclic_energy / self.energy if self.energy > 0 else 0.0


@dataclass
class Null:
    sims: int
    noise_energy: np.ndarray    # simulated cyclic energy - pure noise - one per sim
    triangles: np.ndarray       # simulated significant-triangle count, one per sim
    p_value: float              # cyclic energy at least this large, by noise alone
    triangle_p: float           # this many significant triangles, by noise alone


@dataclass
class Breakdown:
    """The matrix's energy in three parts, as shares that sum to one.

    Noise is the null's mean cyclic energy, in absolute terms: it is set by the
    match counts, not by how much real structure sits beside it, so it carries
    over from the simulated metagames to the observed one. (Comparing cyclic
    *shares* instead would be wrong - the null has no real cycles, so its total
    is smaller and the same noise is a bigger share of it.) Approximate: the
    null's rates are less extreme than the real ones, and log-odds noise grows
    toward the extremes, so the noise share is if anything slightly understated.
    """

    transitive: float
    cyclic: float
    noise: float


@dataclass
class Disc:
    coords: np.ndarray      # (n, 2)
    captured: float         # share of the cyclic energy in this one eigenpair


@dataclass
class Cycles:
    prior: float
    hodge: Hodge
    null: Null
    breakdown: Breakdown
    disc: Disc
    triangles: list[tuple[int, int, int, float]]   # i beats j beats k beats i, weakest-edge z


def hodge(logits: np.ndarray, weights: np.ndarray) -> Hodge:
    """Weighted least-squares split of an antisymmetric matrix into strengths and cycles.

    Minimises sum over i<j of w_ij (L_ij - (r_i - r_j))^2, whose normal
    equations are the weighted graph Laplacian: (D - W) r = rowsum(W * L). The
    Laplacian is singular along the constant vector (strength is only defined
    up to a shift), so lstsq picks the minimum-norm r, which is mean zero.
    """
    laplacian = np.diag(weights.sum(axis=1)) - weights
    strength = np.linalg.lstsq(laplacian, (weights * logits).sum(axis=1), rcond=None)[0]
    strength -= strength.mean()

    observed = weights > 0
    transitive = strength[:, None] - strength[None, :]
    cyclic = np.where(observed, logits - transitive, 0.0)

    # Halved: the full matrix counts every pair twice.
    energy = float((weights * logits ** 2).sum() / 2)
    cyclic_energy = float((weights * cyclic ** 2).sum() / 2)
    return Hodge(strength, transitive, cyclic, energy, cyclic_energy)


def breakdown(h: Hodge, null: "Null") -> Breakdown:
    if h.energy <= 0:
        return Breakdown(0.0, 0.0, 0.0)
    noise = min(float(null.noise_energy.mean()) if null.sims else 0.0, h.cyclic_energy)
    return Breakdown(
        transitive=1 - h.cyclic_share,
        cyclic=(h.cyclic_energy - noise) / h.energy,
        noise=noise / h.energy,
    )


def count_triangles(points: np.ndarray, matches: np.ndarray, z: float = TRIANGLE_Z,
                    min_matches: int = TRIANGLE_MIN_MATCHES) -> int:
    """Directed 3-cycles in the graph of significant edges: trace(A^3) / 3."""
    beats = ((edge_z(points, matches) >= z) & (matches >= min_matches)).astype(float)
    return round(float(np.trace(beats @ beats @ beats)) / 3)


def triangles(points: np.ndarray, matches: np.ndarray, z: float = TRIANGLE_Z,
              min_matches: int = TRIANGLE_MIN_MATCHES) -> list[tuple[int, int, int, float]]:
    """Every i -> j -> k -> i where each edge clears `z`, strongest weakest-edge first.

    Each triangle is listed once, starting from its lowest index.
    """
    zs = np.where(matches >= min_matches, edge_z(points, matches), 0.0)
    n = len(zs)
    found = []
    for i in range(n):
        for j in range(i + 1, n):
            for k in range(i + 1, n):
                if k == j:
                    continue
                weakest = min(zs[i, j], zs[j, k], zs[k, i])
                if weakest >= z:
                    found.append((i, j, k, float(weakest)))
    return sorted(found, key=lambda t: -t[3])


def null_test(m: Matrix, prior: float, h: Hodge, observed_triangles: int,
              sims: int, rng: np.random.Generator) -> Null:
    """Cyclic energy and triangle count under a purely transitive metagame."""
    rate = expit(h.transitive)
    noise = np.zeros(sims)
    tri = np.zeros(sims)
    for s in range(sims):
        points = resample(m.points, m.matches, rate, rng)
        noise[s] = hodge(shrunk_logit(points, m.matches, prior), m.matches).cyclic_energy
        tri[s] = count_triangles(points, m.matches)
    return Null(
        sims=sims,
        noise_energy=noise,
        triangles=tri,
        p_value=float((1 + (noise >= h.cyclic_energy).sum()) / (1 + sims)),
        triangle_p=float((1 + (tri >= observed_triangles).sum()) / (1 + sims)),
    )


def disc(cyclic: np.ndarray, weights: np.ndarray, prior: float) -> Disc:
    """Embed the cyclic part as the disc game of its largest eigenpair.

    A real antisymmetric matrix has eigenvalues in pairs +-i*sigma. The top
    pair is the rank-2 piece 2*sigma*(a b^T - b a^T); placing deck i at
    sqrt(2*sigma) * (a_i, b_i) makes its advantage over j the 2D cross product
    x_i x x_j, so i beats the decks counter-clockwise of it and loses to those
    clockwise. Cells are damped by n / (n + prior) first, so a thin cell's
    residual does not drag a deck around the plane.
    """
    damped = cyclic * weights / (weights + prior)
    # i*A is Hermitian, so eigh applies; its eigenvalue sigma belongs to
    # eigenvalue -i*sigma of A, whose conjugate eigenvector carries +i*sigma.
    values, vectors = np.linalg.eigh(1j * damped)
    sigma = values[-1]
    z = np.conj(vectors[:, -1])
    coords = np.sqrt(max(2 * sigma, 0.0)) * np.column_stack([z.real, z.imag])

    energy = (damped ** 2).sum()
    captured = float(2 * sigma ** 2 / energy) if energy > 0 else 0.0
    return Disc(coords, captured)


def fit(m: Matrix, sims: int = 500, rng: np.random.Generator | None = None) -> Cycles:
    rng = rng or np.random.default_rng(0)
    prior = prior_strength(m.points, m.matches)
    h = hodge(shrunk_logit(m.points, m.matches, prior), m.matches)
    found = triangles(m.points, m.matches)
    null = null_test(m, prior, h, len(found), sims, rng)
    return Cycles(
        prior=prior,
        hodge=h,
        null=null,
        breakdown=breakdown(h, null),
        disc=disc(h.cyclic, m.matches, prior),
        triangles=found,
    )


def expected_score(strength: np.ndarray) -> np.ndarray:
    """A deck's strength read as its expected score against a field of average strength."""
    return expit(strength)
