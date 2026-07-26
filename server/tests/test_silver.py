"""The silver refresh driver.

The transform is SQL and is not exercised here. What is worth pinning down is
the driver's contract with it: the three refreshes run in an order the foreign
keys allow, tournaments are handed over in bounded batches, and a batch that
blows up costs only itself.
"""

import argparse

import pytest

from app import silver, supabase


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
        self.calls: list[tuple[str, list[str]]] = []

    def request(self, method, url, **kwargs):
        if method == "POST":
            step = url.rsplit("/rpc/refresh_silver_", 1)[1]
            batch = kwargs["json"]["p_tournaments"]
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
        monkeypatch.setattr(silver.httpx, "Client", lambda **_: _NoopContext(client))
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
    defaults = dict(chunk_size=2, tournament=None, only=None, dry_run=False)
    return argparse.Namespace(**{**defaults, **overrides})


def test_pages_past_the_postgrest_row_cap(_client, monkeypatch):
    """PostgREST caps a response at 1000 rows whatever limit is asked for."""
    monkeypatch.setattr(silver, "PAGE_SIZE", 2)
    client = _client(FakeClient(ids=["a", "b", "c", "d", "e"]))

    silver.run(_args(chunk_size=10))

    listed = [batch for step, batch in client.calls if step == "tournaments"]
    assert listed == [["a", "b", "c", "d", "e"]]


def test_refreshes_in_foreign_key_order(_client):
    """Both child tables inner-join silver_tournaments, so it must go first."""
    client = _client(FakeClient(ids=["a", "b", "c"]))

    assert silver.run(_args()) == 0

    steps = [step for step, _ in client.calls]
    assert steps == ["tournaments"] * 2 + ["standings"] * 2 + ["pairings"] * 2


def test_batches_by_chunk_size(_client):
    client = _client(FakeClient(ids=["a", "b", "c", "d", "e"]))

    silver.run(_args(chunk_size=2))

    batches = [batch for step, batch in client.calls if step == "pairings"]
    assert batches == [["a", "b"], ["c", "d"], ["e"]]


def test_one_failed_batch_does_not_stop_the_run(_client):
    """A timed-out batch is redone by the next run - it must not abort this one."""
    client = _client(FakeClient(ids=["a", "b", "c", "d"], fail_on=["standings"]))

    # 2 of 6 batch-slots failing is over the tolerance, so the run reports failure...
    assert silver.run(_args()) == 1
    # ...but pairings still ran to completion afterwards.
    assert [batch for step, batch in client.calls if step == "pairings"] == [
        ["a", "b"],
        ["c", "d"],
    ]


def test_occasional_failure_is_tolerated(_client):
    """Under a tenth of batches failing is expected and self-heals."""

    class FlakyOnce(FakeClient):
        def __init__(self, ids):
            super().__init__(ids)
            self.blown = False

        def request(self, method, url, **kwargs):
            if method == "POST" and not self.blown:
                self.blown = True
                self.calls.append(("pairings", kwargs["json"]["p_tournaments"]))
                raise RuntimeError("blip")
            return super().request(method, url, **kwargs)

    ids = [str(n) for n in range(40)]
    _client(FlakyOnce(ids))

    assert silver.run(_args(chunk_size=2)) == 0


def test_only_limits_the_steps(_client):
    client = _client(FakeClient(ids=["a"]))

    silver.run(_args(only=["pairings"]))

    assert [step for step, _ in client.calls] == ["pairings"]


def test_single_tournament_skips_the_listing(_client):
    client = _client(FakeClient(ids=["a", "b", "c"]))

    silver.run(_args(tournament="b"))

    assert all(batch == ["b"] for _, batch in client.calls)
    assert len(client.calls) == 3


def test_dry_run_writes_nothing(_client):
    client = _client(FakeClient(ids=["a", "b"]))

    assert silver.run(_args(dry_run=True)) == 0
    assert client.calls == []


def test_rpc_surfaces_a_client_error():
    """A 4xx from a refresh function is a bug in the SQL, not a blip."""

    class Broken:
        def request(self, method, url, **kwargs):
            return FakeResponse(400)

    with pytest.raises(RuntimeError, match="rpc refresh_silver_pairings failed"):
        supabase.rpc(Broken(), "http://db", {}, "refresh_silver_pairings", {})
