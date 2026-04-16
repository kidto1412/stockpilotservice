from __future__ import annotations

import argparse
import logging
import time
from datetime import datetime, timezone
from typing import List

from config import get_settings, parse_symbols
from db import SyncRun, coerce_date, connect, ensure_schema, insert_official_events, insert_technical_snapshots, log_sync_run
from sources.idx_source import fetch_idx_corporate_actions, fetch_idx_news
from sources.tradingview_source import fetch_tradingview_snapshots


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("market-sync")


def run_once(symbols: List[str], source: str) -> None:
    settings = get_settings()
    with connect(settings.database_url) as conn:
        ensure_schema(conn)

        if source in ("all", "tradingview"):
            _run_tradingview(conn, settings, symbols)

        if source in ("all", "idx"):
            _run_idx(conn, settings)


def _run_tradingview(conn, settings, symbols: List[str]) -> None:
    started = datetime.now(timezone.utc)
    run = SyncRun(source="TRADINGVIEW", started_at=started, status="SUCCESS", message="OK")

    try:
        rows = fetch_tradingview_snapshots(
            symbols=symbols,
            scanner_url=settings.tradingview_scanner_url,
            timeout_sec=settings.request_timeout_sec,
        )
        total = insert_technical_snapshots(conn, rows)
        run.message = f"upsert technical rows: {total}"
        logger.info("TradingView sync selesai: %s", run.message)
    except Exception as exc:
        run.status = "FAILED"
        run.message = str(exc)
        logger.exception("TradingView sync gagal")
    finally:
        run.finished_at = datetime.now(timezone.utc)
        log_sync_run(conn, run)


def _run_idx(conn, settings) -> None:
    started = datetime.now(timezone.utc)
    run = SyncRun(source="IDX", started_at=started, status="SUCCESS", message="OK")

    try:
        corp_actions = fetch_idx_corporate_actions(
            url=settings.idx_corporate_action_url,
            timeout_sec=settings.request_timeout_sec,
        )
        news_items = fetch_idx_news(
            url=settings.idx_news_url,
            timeout_sec=settings.request_timeout_sec,
        )

        merged = corp_actions + news_items
        for row in merged:
            row["event_date"] = coerce_date(row.get("event_date"))

        total = insert_official_events(conn, merged)
        run.message = f"upsert official events: {total}"
        logger.info("IDX sync selesai: %s", run.message)
    except Exception as exc:
        run.status = "FAILED"
        run.message = str(exc)
        logger.exception("IDX sync gagal")
    finally:
        run.finished_at = datetime.now(timezone.utc)
        log_sync_run(conn, run)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync market technical + official IDX data via endpoint API/XHR",
    )
    parser.add_argument(
        "--symbols",
        default="BBCA,TLKM,ASII,BMRI,BBRI",
        help="Daftar simbol dipisah koma",
    )
    parser.add_argument(
        "--source",
        choices=["all", "tradingview", "idx"],
        default="all",
        help="Pilih sumber sinkronisasi",
    )
    parser.add_argument(
        "--interval-min",
        type=int,
        default=0,
        help="Jika > 0, jalankan sinkron berkala per N menit",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    symbols = parse_symbols(args.symbols)

    if not symbols and args.source in ("all", "tradingview"):
        raise ValueError("Minimal 1 symbol untuk sinkron TradingView")

    if args.interval_min <= 0:
        run_once(symbols=symbols, source=args.source)
        return

    logger.info(
        "Scheduler aktif. source=%s interval=%s menit symbols=%s",
        args.source,
        args.interval_min,
        ",".join(symbols),
    )
    while True:
        cycle_start = time.time()
        run_once(symbols=symbols, source=args.source)
        elapsed = time.time() - cycle_start
        sleep_sec = max(args.interval_min * 60 - elapsed, 1)
        time.sleep(sleep_sec)


if __name__ == "__main__":
    main()
