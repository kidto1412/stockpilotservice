from __future__ import annotations

import argparse
import logging
import time
from datetime import datetime, timezone
from typing import List

from config import get_settings, parse_symbols
from db import SyncRun, connect, ensure_schema, insert_technical_snapshots, log_sync_run
from sources.tradingview_source import fetch_tradingview_snapshots


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("market-sync")


def run_once(symbols: List[str], full_sync: bool = False) -> None:
    settings = get_settings()
    with connect(settings.database_url) as conn:
        ensure_schema(conn)

        if full_sync:
            logger.info(
                "--full-sync scan semua saham IDX, snapshot teknikal terbaru."
            )
        _run_tradingview(conn, settings, symbols)


def _run_tradingview(conn, settings, symbols: List[str]) -> None:
    started = datetime.now(timezone.utc)
    run = SyncRun(source="TRADINGVIEW", started_at=started, status="SUCCESS", message="OK")

    try:
        rows = fetch_tradingview_snapshots(
            symbols=symbols,
            scanner_url=settings.tradingview_scanner_url,
            timeout_sec=settings.request_timeout_sec,
            all_page_size=settings.tradingview_all_page_size,
            all_max_rows=settings.tradingview_all_max_rows,
        )
        total = insert_technical_snapshots(conn, rows)
        mode = "ALL_SYMBOLS" if not symbols else "SELECTED_SYMBOLS"
        run.message = f"{mode} upsert technical rows: {total}"
        logger.info("TradingView sync selesai: %s", run.message)
    except Exception as exc:
        run.status = "FAILED"
        run.message = str(exc)
        logger.exception("TradingView sync gagal")
    finally:
        run.finished_at = datetime.now(timezone.utc)
        log_sync_run(conn, run)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync market technical snapshot dari TradingView ke DB",
    )
    parser.add_argument(
        "--symbols",
        default="",
        help="Daftar simbol dipisah koma. Kosongkan untuk auto-scan semua saham IDX",
    )
    parser.add_argument(
        "--interval-min",
        type=int,
        default=0,
        help="Jika > 0, jalankan sinkron berkala per N menit",
    )
    parser.add_argument(
        "--full-sync",
        action="store_true",
        help="Scan semua saham IDX (snapshot teknikal), upsert ke DB",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    symbols = parse_symbols(args.symbols)

    if args.interval_min <= 0:
        run_once(symbols=symbols, full_sync=args.full_sync)
        return

    if args.full_sync:
        logger.warning("--full-sync hanya perlu jalankan sekali saja untuk backfill awal.")

    logger.info(
        "Scheduler aktif. interval=%s menit symbols=%s",
        args.interval_min,
        ",".join(symbols) if symbols else "ALL_IDX",
    )
    while True:
        cycle_start = time.time()
        run_once(symbols=symbols, full_sync=args.full_sync)
        elapsed = time.time() - cycle_start
        sleep_sec = max(args.interval_min * 60 - elapsed, 1)
        time.sleep(sleep_sec)


if __name__ == "__main__":
    main()
