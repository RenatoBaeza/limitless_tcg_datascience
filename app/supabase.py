"""Thin helpers over the Supabase PostgREST API, shared by the ingest scripts."""

import os
from typing import Any

import httpx2 as httpx
from dotenv import load_dotenv


def credentials() -> tuple[str, str]:
    """Read Supabase credentials from .env locally or the environment in CI.

    Raises RuntimeError with an actionable message when either is missing.
    """
    load_dotenv()
    missing = [
        name
        for name in ("SUPABASE_URL", "SUPABASE_SECRET_KEY")
        if not os.environ.get(name)
    ]
    if missing:
        raise RuntimeError(
            f"missing {', '.join(missing)}. Set them in .env locally, or as "
            "repository secrets for the scheduled workflow."
        )
    return os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SECRET_KEY"]


def headers(secret_key: str) -> dict[str, str]:
    return {
        "apikey": secret_key,
        "Authorization": f"Bearer {secret_key}",
        "Content-Type": "application/json",
    }


def count_rows(
    client: httpx.Client,
    base: str,
    hdrs: dict[str, str],
    table: str,
    params: dict[str, str] | None = None,
) -> int:
    """Exact row count, read off the Content-Range header."""
    response = client.get(
        f"{base}/rest/v1/{table}",
        params={"select": "*", "limit": "1", **(params or {})},
        headers={**hdrs, "Prefer": "count=exact"},
    )
    response.raise_for_status()
    return int(response.headers.get("content-range", "*/0").split("/")[-1])


def upsert(
    client: httpx.Client,
    base: str,
    hdrs: dict[str, str],
    table: str,
    rows: list[dict[str, Any]],
    on_conflict: str = "id",
) -> None:
    response = client.post(
        f"{base}/rest/v1/{table}",
        params={"on_conflict": on_conflict},
        headers={**hdrs, "Prefer": "resolution=merge-duplicates,return=minimal"},
        json=rows,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"upsert into {table} failed ({response.status_code}): {response.text}")


def patch(
    client: httpx.Client,
    base: str,
    hdrs: dict[str, str],
    table: str,
    match: dict[str, str],
    values: dict[str, Any],
) -> None:
    response = client.patch(
        f"{base}/rest/v1/{table}",
        params=match,
        headers={**hdrs, "Prefer": "return=minimal"},
        json=values,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"patch on {table} failed ({response.status_code}): {response.text}")
