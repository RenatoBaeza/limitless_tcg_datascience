"""The metagame endpoints.

The gold functions they call are SQL and are not exercised here. What these
pin down is the layer between: that the query string is validated, that it
reaches the right function under the right argument names, and that the rows
coming back survive the response models intact.
"""

import pytest
from fastapi.testclient import TestClient

from app import metagame
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _no_cache():
    """Each test asserts on its own calls, so no test may see another's memo."""
    metagame.clear_cache()
    yield
    metagame.clear_cache()


@pytest.fixture
def rpc(monkeypatch):
    """Capture the (function, payload) each endpoint sends, and reply with rows."""
    calls: list[tuple[str, dict]] = []
    replies: dict[str, list] = {}

    def fake_call(function, payload):
        calls.append((function, payload))
        return replies.get(function, [])

    monkeypatch.setattr(metagame, "_call", fake_call)
    return calls, replies


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_matrix_passes_the_window_through(rpc):
    calls, _ = rpc

    response = client.get("/matchups?from=2026-01-01&to=2026-03-31&limit=8&min_matches=25")

    assert response.status_code == 200
    assert calls == [
        (
            "gold_matchup_matrix",
            {
                "p_from": "2026-01-01",
                "p_to": "2026-03-31",
                "p_decks": None,
                "p_limit": 8,
                "p_min_matches": 25,
                "p_include_other": False,
            },
        )
    ]


def test_matrix_pins_both_axes_when_decks_are_given(rpc):
    calls, _ = rpc

    client.get("/matchups?decks=dragapult-ex&decks=n-zoroark")

    assert calls[0][1]["p_decks"] == ["dragapult-ex", "n-zoroark"]


def test_an_absent_window_is_sent_as_null(rpc):
    """The SQL reads null as "no bound", so an absent filter must not be dropped."""
    calls, _ = rpc

    client.get("/decks")

    assert calls[0][1]["p_from"] is None
    assert calls[0][1]["p_to"] is None


def test_deck_rows_survive_the_response_model(rpc):
    _, replies = rpc
    replies["gold_deck_summary"] = [
        {
            "deck_id": "dragapult-dusknoir",
            "deck_name": "Dragapult Dusknoir",
            "deck_icons": ["dragapult", "dusknoir"],
            "entries": 9439,
            "tournaments": 812,
            "meta_share": 0.0835,
            "matches": 41022,
            "wins": 21800,
            "losses": 16900,
            "ties": 2322,
            "win_rate": 0.5633,
            "score_rate": 0.5597,
            "score_low": 0.5549,
            "score_high": 0.5645,
            "champions": 71,
            "top8": 640,
        }
    ]

    deck = client.get("/decks").json()[0]

    assert deck["deck_id"] == "dragapult-dusknoir"
    assert deck["deck_icons"] == ["dragapult", "dusknoir"]
    assert deck["score_low"] < deck["score_rate"] < deck["score_high"]


def test_a_null_rate_stays_null(rpc):
    """A cell with only ties has no win_rate - it must not become 0."""
    _, replies = rpc
    replies["gold_matchup_matrix"] = [
        {
            "deck_a": "a",
            "deck_b": "b",
            "matches": 2,
            "wins": 0,
            "losses": 0,
            "ties": 2,
            "win_rate": None,
            "score_rate": 0.5,
            "score_low": 0.0947,
            "score_high": 0.9053,
        }
    ]

    cell = client.get("/matchups").json()[0]

    assert cell["win_rate"] is None
    assert cell["score_rate"] == 0.5


def test_deck_matchups_scopes_to_the_deck(rpc):
    calls, _ = rpc

    client.get("/decks/n-zoroark/matchups?min_matches=50")

    function, payload = calls[0]
    assert function == "gold_deck_matchups"
    assert payload["p_deck"] == "n-zoroark"
    assert payload["p_min_matches"] == 50


def test_an_unknown_deck_is_an_empty_list_not_a_404(rpc):
    response = client.get("/decks/not-a-deck/matchups")

    assert response.status_code == 200
    assert response.json() == []


def test_coverage_tolerates_an_empty_gold_layer(rpc):
    """Before the first refresh every aggregate is null - that is not an error."""
    response = client.get("/coverage")

    assert response.status_code == 200
    assert response.json()["tournaments"] == 0


def test_a_bad_limit_is_rejected(rpc):
    assert client.get("/matchups?limit=1").status_code == 422
    assert client.get("/matchups?limit=101").status_code == 422


def test_results_are_memoed_across_requests(rpc):
    calls, _ = rpc

    client.get("/decks?limit=10")
    client.get("/decks?limit=10")

    assert len(calls) == 1


def test_different_windows_are_memoed_apart(rpc):
    calls, _ = rpc

    client.get("/decks?from=2026-01-01")
    client.get("/decks?from=2026-02-01")

    assert len(calls) == 2
