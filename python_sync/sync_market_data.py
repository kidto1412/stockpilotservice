from __future__ import annotations

import argparse
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import List

from config import get_settings, parse_symbols
from db import (
    SyncRun,
    connect,
    ensure_schema,
    insert_official_events,
    insert_price_history,
    insert_technical_snapshots,
    log_sync_run,
)
from sources.tradingview_source import fetch_tradingview_snapshots
from sources.bisnis_source import fetch_bisnis_news
from sources.yahoo_history_source import (
    fetch_yahoo_daily_history,
    fetch_yahoo_daily_history_between,
)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("market-sync")


def run_once(
    symbols: List[str],
    full_sync: bool = False,
    history_years: int = 10,
    include_history: bool = True,
) -> None:
    settings = get_settings()
    with connect(settings.database_url) as conn:
        ensure_schema(conn)

        if full_sync:
            logger.info(
                "--full-sync scan semua saham IDX, snapshot teknikal + news terbaru."
            )
        synced_symbols = _run_tradingview(conn, settings, symbols)
        if include_history and synced_symbols:
            _run_daily_history(
                conn,
                settings,
                synced_symbols,
                full_sync=full_sync,
                history_years=history_years,
            )
        _run_bisnis_news(conn, settings)


def _run_tradingview(conn, settings, symbols: List[str]) -> List[str]:
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
        synced_symbols = sorted({str(row.get("symbol", "")).upper() for row in rows if row.get("symbol")})
        mode = "ALL_SYMBOLS" if not symbols else "SELECTED_SYMBOLS"
        run.message = f"{mode} upsert technical rows: {total}"
        logger.info("TradingView sync selesai: %s", run.message)
        return synced_symbols
    except Exception as exc:
        run.status = "FAILED"
        run.message = str(exc)
        logger.exception("TradingView sync gagal")
        return []
    finally:
        run.finished_at = datetime.now(timezone.utc)
        log_sync_run(conn, run)


def _run_daily_history(
    conn,
    settings,
    symbols: List[str],
    full_sync: bool,
    history_years: int,
) -> None:
    started = datetime.now(timezone.utc)
    run = SyncRun(source="YAHOO_HISTORY", started_at=started, status="SUCCESS", message="OK")

    try:
        if full_sync:
            rows = fetch_yahoo_daily_history(
                symbols=symbols,
                timeout_sec=settings.request_timeout_sec,
                years=history_years,
            )
            mode = f"BACKFILL_{history_years}Y"
        else:
            end_at = datetime.now(timezone.utc)
            start_at = end_at - timedelta(days=max(settings.history_incremental_days, 1))
            rows = fetch_yahoo_daily_history_between(
                symbols=symbols,
                timeout_sec=settings.request_timeout_sec,
                start_at=start_at,
                end_at=end_at,
            )
            mode = f"INCREMENTAL_{settings.history_incremental_days}D"

        total = insert_price_history(conn, rows)
        run.message = f"{mode} upsert candle rows: {total}, symbols={len(symbols)}"
        logger.info("Yahoo history sync selesai: %s", run.message)
    except Exception as exc:
        run.status = "FAILED"
        run.message = str(exc)
        logger.exception("Yahoo history sync gagal")
    finally:
        run.finished_at = datetime.now(timezone.utc)
        log_sync_run(conn, run)


def _run_bisnis_news(conn, settings) -> None:
    started = datetime.now(timezone.utc)
    run = SyncRun(source="BISNIS_COM", started_at=started, status="SUCCESS", message="OK")

    try:
        rows = fetch_bisnis_news(
            rss_url=settings.bisnis_rss_url,
            timeout_sec=settings.request_timeout_sec,
        )
        total = insert_official_events(conn, rows)
        run.message = f"upsert news/events: {total}"
        logger.info("Bisnis.com news sync selesai: %s", run.message)
    except Exception as exc:
        run.status = "FAILED"
        run.message = str(exc)
        logger.exception("Bisnis.com news sync gagal")
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
    parser.add_argument(
        "--history-years",
        type=int,
        default=10,
        help="Jumlah tahun backfill candle harian saat --full-sync (default: 10)",
    )
    parser.add_argument(
        "--skip-history",
        action="store_true",
        help="Lewati sinkronisasi candle history",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    symbols = parse_symbols(args.symbols)

    if args.interval_min <= 0:
        run_once(
            symbols=symbols,
            full_sync=args.full_sync,
            history_years=args.history_years,
            include_history=not args.skip_history,
        )
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
        run_once(
            symbols=symbols,
            full_sync=args.full_sync,
            history_years=args.history_years,
            include_history=not args.skip_history,
        )
        elapsed = time.time() - cycle_start
        sleep_sec = max(args.interval_min * 60 - elapsed, 1)
        time.sleep(sleep_sec)


if __name__ == "__main__":
    main()
