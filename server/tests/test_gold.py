"""The gold refresh driver.

The transform is SQL and is not exercised here. What is worth pinning down is
the driver's contract with it: the facts are batched, the deck roll-up is not
and runs last, and a batch that blows up costs only itself.
"""

import argparse

import pytest

from app import gold, supabase


class FakeResponse:
    def __init__(self, status_code=200, json_data=None, headers=None):
        self.status_code = status_code
        self._json = json_data
        self.headers = headers or {}
        self.text = ""

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeClient:
    """Serves the tournament listing and records every refresh call.

    `fail_on` names steps whose calls should raise, to stand in for a batch that
    hits a statement timeout.
    """

    def __init__(self, ids, fail_on=(), rows_per_call=7):
        self.ids = ids
        self.fail_on = set(fail_on)
        self.rows_per_call = rows_per_call
        self.calls: list[tuple[str, list[str] | None]] = []

    def request(self, method, url, **kwargs):
        if method == "POST":
            step = url.rsplit("/rpc/refresh_gold_", 1)[1]
            batch = kwargs["json"].get("p_tournaments")
            self.calls.append((step, batch))
            if step in self.fail_on:
                raise RuntimeError("statement timeout")
            return FakeResponse(200, json_data=self.rows_per_call)

        params = kwargs.get("params", {})
        if url.endswith("/bronze_tournaments") and params.get("select") == "id":
            offset = int(params["offset"])
            limit = int(params["limit"])
            page = self.ids[offset : offset + limit]
            return FakeResponse(200, json_data=[{"id": i} for i in page])

        # Anything else is a count_rows probe.
        return FakeResponse(200, headers={"content-range": "0-0/0"})


@pytest.fixture(autouse=True)
def _credentials(monkeypatch):
    monkeypatch.setattr(supabase, "credentials", lambda: ("http://db", "secret"))
    monkeypatch.setattr(supabase.time, "sleep", lambda _: None)


@pytest.fixture
def _client(monkeypatch):
    def install(client):
        monkeypatch.setattr(gold.httpx, "Client", lambda **_: _NoopContext(client))
        return client

    return install


class _NoopContext:
    def __init__(self, client):
        self.client = client

    def __enter__(self):
        return self.client

    def __exit__(self, *exc):
        return False


def _args(**overrides):
    defaults = dict(
        chunk_size=2,
        tournament=None,
        only=None,
        window_months=gold.RETAIN_MONTHS,
        dry_run=False,
    )
    return argparse.Namespace(**{**defaults, **overrides})


def test_rollup_runs_last_and_unbatched(_client):
    """gold_decks aggregates both fact tables, so it can only run once they are
    complete - and it is keyed on deck, so there is no batch to hand it."""
    client = _client(FakeClient(ids=["a", "b", "c"]))

    assert gold.run(_args()) == 0

    steps = [step for step, _ in client.calls]
    assert steps == ["deck_events"] * 2 + ["matchups"] * 2 + ["decks"]
    assert client.calls[-1] == ("decks", None)


def test_listing_honours_the_retention_window(_client):
    """The refresh is handed only in-window tournaments, so it cannot re-add
    the rows prune_window deleted."""
    seen: list[dict] = []
    _client(_RecordingClient(ids=["a", "b", "c"], seen=seen))

    gold.run(_args(window_months=3))

    assert seen, "expected the tournament listing to be captured"
    for params in seen:
        assert params.get("date") == f"gte.{gold.retention_cutoff(3).isoformat()}"


def test_window_months_zero_lists_everything(_client):
    """0 disables the window - the escape hatch for a whole-database rebuild."""
    seen: list[dict] = []
    _client(_RecordingClient(ids=["a", "b", "c"], seen=seen))

    gold.run(_args(window_months=0))

    assert seen, "expected the tournament listing to be captured"
    assert all("date" not in params for params in seen)


class _RecordingClient(FakeClient):
    def __init__(self, ids, seen):
        super().__init__(ids)
        self.seen = seen

    def request(self, method, url, **kwargs):
        if url.endswith("/bronze_tournaments") and kwargs.get("params", {}).get("select") == "id":
            self.seen.append(kwargs["params"])
        return super().request(method, url, **kwargs)


def test_batches_facts_by_chunk_size(_client):
    client = _client(FakeClient(ids=["a", "b", "c", "d", "e"]))

    gold.run(_args(chunk_size=2))

    batches = [batch for step, batch in client.calls if step == "matchups"]
    assert batches == [["a", "b"], ["c", "d"], ["e"]]


def test_pages_past_the_postgrest_row_cap(_client, monkeypatch):
    """PostgREST caps a response at 1000 rows whatever limit is asked for."""
    monkeypatch.setattr(gold, "PAGE_SIZE", 2)
    client = _client(FakeClient(ids=["a", "b", "c", "d", "e"]))

    gold.run(_args(chunk_size=10))

    listed = [batch for step, batch in client.calls if step == "deck_events"]
    assert listed == [["a", "b", "c", "d", "e"]]


def test_one_failed_batch_does_not_stop_the_run(_client):
    """A timed-out batch is redone by the next run - it must not abort this one."""
    client = _client(FakeClient(ids=["a", "b", "c", "d"], fail_on=["deck_events"]))

    # 2 of 5 call-slots failing is over the tolerance, so the run reports failure...
    assert gold.run(_args()) == 1
    # ...but the later steps still ran to completion.
    assert [batch for step, batch in client.calls if step == "matchups"] == [
        ["a", "b"],
        ["c", "d"],
    ]
    assert ("decks", None) in client.calls


def test_occasional_failure_is_tolerated(_client):
    """Under a tenth of calls failing is expected and self-heals."""

    class FlakyOnce(FakeClient):
        def __init__(self, ids):
            super().__init__(ids)
            self.blown = False

        def request(self, method, url, **kwargs):
            if method == "POST" and not self.blown:
                self.blown = True
                self.calls.append(("matchups", kwargs["json"].get("p_tournaments")))
                raise RuntimeError("blip")
            return super().request(method, url, **kwargs)

    ids = [str(n) for n in range(40)]
    _client(FlakyOnce(ids))

    assert gold.run(_args(chunk_size=2)) == 0


def test_only_limits_the_steps(_client):
    client = _client(FakeClient(ids=["a"]))

    gold.run(_args(only=["matchups"]))

    assert [step for step, _ in client.calls] == ["matchups"]


def test_single_tournament_still_rolls_up_every_deck(_client):
    """--tournament narrows the facts, but gold_decks has no per-tournament slice."""
    client = _client(FakeClient(ids=["a", "b", "c"]))

    gold.run(_args(tournament="b"))

    assert client.calls == [
        ("deck_events", ["b"]),
        ("matchups", ["b"]),
        ("decks", None),
    ]


def test_dry_run_writes_nothing(_client):
    client = _client(FakeClient(ids=["a", "b"]))

    assert gold.run(_args(dry_run=True)) == 0
    assert client.calls == []
