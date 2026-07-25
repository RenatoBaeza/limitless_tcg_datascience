"""Thin helpers over the Supabase PostgREST API, shared by the ingest scripts.

Every request goes through `_send`, which retries transient network failures.
Ingest runs last the better part of an hour, so a single dropped connection
must not take the whole run down.
"""

import os
import time
from typing import Any

import httpx2 as httpx
from dotenv import load_dotenv

MAX_ATTEMPTS = 4
BACKOFF_SECONDS = 2.0

# Transient by nature: retrying is safe because upserts and the progress patch
# are both idempotent.
TRANSIENT_STATUS = {502, 503, 504, 408, 429}


def _send(client: httpx.Client, method: str, url: str, **kwargs: Any) -> httpx.Response:
    """Issue a request, retrying timeouts, connection drops and 5xx."""
    last_error: Exception | None = None

    for attempt in range(MAX_ATTEMPTS):
        if attempt:
            time.sleep(BACKOFF_SECONDS * (2 ** (attempt - 1)))
        try:
            response = client.request(method, url, **kwargs)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = exc
            continue

        if response.status_code in TRANSIENT_STATUS and attempt < MAX_ATTEMPTS - 1:
            last_error = RuntimeError(f"HTTP {response.status_code}")
            continue
        return response

    raise RuntimeError(f"{method} {url} failed after {MAX_ATTEMPTS} attempts: {last_error}")


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
    response = _send(
        client,
        "GET",
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
    response = _send(
        client,
        "POST",
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
    response = _send(
        client,
        "PATCH",
        f"{base}/rest/v1/{table}",
        params=match,
        headers={**hdrs, "Prefer": "return=minimal"},
        json=values,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"patch on {table} failed ({response.status_code}): {response.text}")
