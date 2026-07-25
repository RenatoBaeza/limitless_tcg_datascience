"""Manual ingest trigger, gated by a secret word in the URL rather than a
header - lets it be hit from anywhere that can issue a GET (cron pingers,
browser, curl) without extra client support. Which secret matches picks the
job: ADMIN_KEY_STANDINGS runs ingest_standings, ADMIN_KEY_PAIRINGS runs
ingest_pairings. A run takes minutes (rate-limited to ~1 tournament/6.2s), so
it's dispatched to a background task and the request returns immediately.
"""

import argparse
import os
from typing import Callable

from dotenv import load_dotenv
from fastapi import APIRouter, BackgroundTasks, HTTPException

from app import ingest
from app.limitless import to_pairing_row, to_standing_row

router = APIRouter(prefix="/admin", tags=["admin"])


def _run_standings(args: argparse.Namespace) -> None:
    ingest.run(
        args,
        resource="standings",
        table="standings",
        row_mapper=to_standing_row,
        on_conflict="tournament_id,player",
        key=lambda row: (row["tournament_id"], row["player"]),
    )


def _run_pairings(args: argparse.Namespace) -> None:
    ingest.run(
        args,
        resource="pairings",
        table="pairings",
        row_mapper=to_pairing_row,
        on_conflict="id",
        key=lambda row: row["id"],
    )


_JOBS: dict[str, Callable[[argparse.Namespace], None]] = {
    "ADMIN_KEY_STANDINGS": _run_standings,
    "ADMIN_KEY_PAIRINGS": _run_pairings,
}


def _resolve_job(secret: str) -> Callable[[argparse.Namespace], None] | None:
    load_dotenv()
    for env_name, job in _JOBS.items():
        expected = os.environ.get(env_name)
        if expected and secret == expected:
            return job
    return None


@router.get("/ingest/{secret}", status_code=202)
def trigger_ingest(secret: str, background_tasks: BackgroundTasks) -> dict[str, str]:
    job = _resolve_job(secret)
    if job is None:
        # 404 rather than 401/403 - a wrong secret shouldn't confirm the
        # endpoint exists.
        raise HTTPException(status_code=404)

    args = argparse.Namespace(
        max_requests=300, restale_hours=48, tournament=None, dry_run=False
    )
    background_tasks.add_task(job, args)
    return {"started": job.__name__.removeprefix("_run_")}
