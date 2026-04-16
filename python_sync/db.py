from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Dict, Iterable

import psycopg
from psycopg.types.json import Jsonb


@dataclass
class SyncRun:
    source: str
    started_at: datetime
    status: str
    message: str
    finished_at: datetime | None = None


DDL = """
CREATE TABLE IF NOT EXISTS market_technical_snapshot (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    symbol TEXT NOT NULL,
    snapshot_at TIMESTAMPTZ NOT NULL,
    close_price DOUBLE PRECISION,
    volume BIGINT,
    rsi DOUBLE PRECISION,
    macd DOUBLE PRECISION,
    macd_signal DOUBLE PRECISION,
    ema20 DOUBLE PRECISION,
    ema50 DOUBLE PRECISION,
    raw_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source, symbol, snapshot_at)
);

CREATE TABLE IF NOT EXISTS market_event_official (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    event_type TEXT NOT NULL,
    dedup_key TEXT NOT NULL,
    symbol TEXT,
    title TEXT NOT NULL,
    event_date DATE,
    reference_url TEXT,
    external_id TEXT,
    raw_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source, event_type, dedup_key)
);

CREATE TABLE IF NOT EXISTS sync_run_log (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""


def connect(database_url: str) -> psycopg.Connection:
    return psycopg.connect(database_url)


def ensure_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(DDL)
    conn.commit()


def insert_technical_snapshots(
    conn: psycopg.Connection,
    rows: Iterable[Dict[str, Any]],
) -> int:
    query = """
    INSERT INTO market_technical_snapshot (
        source, symbol, snapshot_at, close_price, volume,
        rsi, macd, macd_signal, ema20, ema50, raw_payload
    ) VALUES (
        %(source)s, %(symbol)s, %(snapshot_at)s, %(close_price)s, %(volume)s,
        %(rsi)s, %(macd)s, %(macd_signal)s, %(ema20)s, %(ema50)s, %(raw_payload)s
    )
    ON CONFLICT (source, symbol, snapshot_at)
    DO UPDATE SET
        close_price = EXCLUDED.close_price,
        volume = EXCLUDED.volume,
        rsi = EXCLUDED.rsi,
        macd = EXCLUDED.macd,
        macd_signal = EXCLUDED.macd_signal,
        ema20 = EXCLUDED.ema20,
        ema50 = EXCLUDED.ema50,
        raw_payload = EXCLUDED.raw_payload;
    """

    count = 0
    with conn.cursor() as cur:
        for row in rows:
            row = dict(row)
            row["raw_payload"] = Jsonb(row.get("raw_payload"))
            cur.execute(query, row)
            count += 1
    conn.commit()
    return count


def insert_official_events(
    conn: psycopg.Connection,
    rows: Iterable[Dict[str, Any]],
) -> int:
    query = """
    INSERT INTO market_event_official (
        source, event_type, dedup_key, symbol, title,
        event_date, reference_url, external_id, raw_payload
    ) VALUES (
        %(source)s, %(event_type)s, %(dedup_key)s, %(symbol)s, %(title)s,
        %(event_date)s, %(reference_url)s, %(external_id)s, %(raw_payload)s
    )
    ON CONFLICT (source, event_type, dedup_key)
    DO UPDATE SET
        symbol = EXCLUDED.symbol,
        title = EXCLUDED.title,
        event_date = EXCLUDED.event_date,
        raw_payload = EXCLUDED.raw_payload;
    """

    count = 0
    with conn.cursor() as cur:
        for row in rows:
            row = dict(row)
            row["raw_payload"] = Jsonb(row.get("raw_payload"))
            cur.execute(query, row)
            count += 1
    conn.commit()
    return count


def log_sync_run(conn: psycopg.Connection, run: SyncRun) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sync_run_log (source, started_at, finished_at, status, message)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (run.source, run.started_at, run.finished_at, run.status, run.message),
        )
    conn.commit()


def coerce_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except ValueError:
        return None
