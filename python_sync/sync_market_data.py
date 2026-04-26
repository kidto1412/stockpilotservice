from __future__ import annotations

def _run_multi_timeframe_chart(
    conn,
    settings,
    symbols: List[str],
    request_bars: int,
    sync_mode: str,
    batch_size: int = 50,
):
    """
    Fetch dan simpan chart data multi-timeframe dari TradingView.
    Timeframe: 1M, 1W, 5M, 3M, 3D, 12H, 8H, 6H, 2H, 30M, 1D
    """
    timeframes = [
        ("1", "1M"),
        ("5", "5M"),
        ("15", "15M"),
        ("30", "30M"),
        ("60", "1H"),
        ("120", "2H"),
        ("360", "6H"),
        ("480", "8H"),
        ("720", "12H"),
        ("3D", "3D"),
        ("1W", "1W"),
        ("1M", "1Mo"),
        ("1D", "1D"),
    ]
    symbol_batches = _split_into_batches(symbols, batch_size)
    total_rows = 0
    total_batches = len(symbol_batches)
    for tf_res, tf_name in timeframes:
        tf_success = 0
        tf_failed = 0
        logger.info(f"Sync multi-timeframe: {tf_name} ...")
        for batch_num, batch_symbols in enumerate(symbol_batches, start=1):
            try:
                logger.info(
                    f"Multi-TF batch {batch_num}/{total_batches}: timeframe={tf_name} ..."
                )
                batch_rows = fetch_tradingview_candles(
                    symbols=batch_symbols,
                    timeout_sec=settings.request_timeout_sec,
                    request_bars=request_bars,
                    resolution=tf_res,
                    timeframe=tf_name,
                )
                if batch_rows:
                    tf_success += 1
                    batch_total = insert_price_history(conn, batch_rows)
                    total_rows += batch_total
                    logger.info(
                        f"Multi-TF batch {batch_num}/{total_batches} ({tf_name}): +{batch_total} rows, symbols={len(batch_symbols)}"
                    )
                else:
                    raise RuntimeError(f"TradingView returned empty candles for {tf_name}")
            except Exception as tf_exc:
                tf_failed += 1
                logger.warning(
                    f"Multi-TF batch {batch_num}/{total_batches}: TradingView failed, skip this batch (reason: {str(tf_exc)[:80]})"
                )
            if batch_num < total_batches:
                time.sleep(0.5)
        logger.info(f"Multi-TF {tf_name} sync: success={tf_success}, failed={tf_failed}")
    logger.info(f"Multi-TF sync selesai: total_rows={total_rows}, symbols={len(symbols)}")
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


def _run_daily_chart(
    conn,
    settings,
    symbols: List[str],
    request_bars: int,
    sync_mode: str,
    batch_size: int = 50,
) -> None:
    """Fetch chart data dari TradingView (primary only)."""
    started = datetime.now(timezone.utc)
    run = SyncRun(source="CHART_HISTORY", started_at=started, status="SUCCESS", message="OK")

    try:
        symbol_batches = _split_into_batches(symbols, batch_size)
        total_rows = 0
        total_batches = len(symbol_batches)
        tv_success = 0
        tv_failed = 0

        for batch_num, batch_symbols in enumerate(symbol_batches, start=1):
            try:
                # TradingView chart via WebSocket session (same path as chart web)
                logger.info(
                    "Chart batch %d/%d: trying TradingView source (primary)...",
                    batch_num,
                    total_batches,
                )
                try:
                    batch_rows = fetch_tradingview_daily_candles(
                        symbols=batch_symbols,
                        timeout_sec=settings.request_timeout_sec,
                        request_bars=request_bars,
                    )
                    if batch_rows:
                        tv_success += 1
                        batch_total = insert_price_history(conn, batch_rows)
                        total_rows += batch_total
                        logger.info(
                            "Chart batch %d/%d (TradingView): +%d rows, symbols=%d",
                            batch_num,
                            total_batches,
                            batch_total,
                            len(batch_symbols),
                        )
                    else:
                        raise RuntimeError("TradingView returned empty candles")

                except Exception as tv_exc:
                    tv_failed += 1
                    logger.warning(
                        "Chart batch %d/%d: TradingView failed, skip this batch (reason: %s)",
                        batch_num,
                        total_batches,
                        str(tv_exc)[:80],
                    )

                # Throttle antar batch
                if batch_num < total_batches:
                    time.sleep(0.5)

            except Exception as batch_exc:
                logger.warning(
                    "Chart batch %d/%d outer error (skip to next): %s",
                    batch_num,
                    total_batches,
                    str(batch_exc)[:100],
                )

        run.message = f"{sync_mode} upsert candle rows: {total_rows}, symbols={len(symbols)}, TV_success={tv_success}, TV_failed={tv_failed}"
        logger.info("Chart history sync (%s): %s", sync_mode, run.message)
    except Exception as exc:
        logger.warning(
            "Chart history sync outer error (non-fatal, lanjut sync): %s",
            str(exc)[:150],
        )
        run.status = "SUCCESS"
        run.message = f"PARTIAL (error: {str(exc)[:80]})"
    finally:
        run.finished_at = datetime.now(timezone.utc)
        log_sync_run(conn, run)


def _run_daily_history(
    conn,
    settings,
    symbols: List[str],
    full_sync: bool,
    history_years: int,
    batch_size: int = 50,
) -> None:
    """Legacy history sync (unused, kept for compatibility)."""
    logger.info("History sync (legacy) skipped: use chart sync instead")


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


def _run_intraday_chart(
    conn,
    settings,
    symbols: List[str],
    request_bars: int = 720,
    batch_size: int = 50,
) -> None:
    """Fetch chart intraday 1-menit untuk market-hour update (incremental)."""
    started = datetime.now(timezone.utc)
    run = SyncRun(source="CHART_INTRADAY", started_at=started, status="SUCCESS", message="OK")

    try:
        symbol_batches = _split_into_batches(symbols, batch_size)
        total_rows = 0
        total_batches = len(symbol_batches)
        tv_success = 0
        tv_failed = 0

        for batch_num, batch_symbols in enumerate(symbol_batches, start=1):
            try:
                logger.info(
                    "Intraday batch %d/%d: trying TradingView source...",
                    batch_num,
                    total_batches,
                )
                try:
                    batch_rows = fetch_tradingview_intraday_candles(
                        symbols=batch_symbols,
                        timeout_sec=settings.request_timeout_sec,
                        request_bars=request_bars,
                    )
                    if batch_rows:
                        tv_success += 1
                        batch_total = insert_price_history(conn, batch_rows)
                        total_rows += batch_total
                        logger.info(
                            "Intraday batch %d/%d (TradingView): +%d rows, symbols=%d",
                            batch_num,
                            total_batches,
                            batch_total,
                            len(batch_symbols),
                        )
                    else:
                        raise RuntimeError("TradingView intraday returned empty candles")

                except Exception as tv_exc:
                    tv_failed += 1
                    logger.warning(
                        "Intraday batch %d/%d: TradingView failed, skip this batch (reason: %s)",
                        batch_num,
                        total_batches,
                        str(tv_exc)[:80],
                    )

                if batch_num < total_batches:
                    time.sleep(0.5)

            except Exception as batch_exc:
                logger.warning(
                    "Intraday batch %d/%d outer error (skip to next): %s",
                    batch_num,
                    total_batches,
                    str(batch_exc)[:100],
                )

        run.message = f"INTRADAY_1M upsert candle rows: {total_rows}, symbols={len(symbols)}, TV_success={tv_success}, TV_failed={tv_failed}"
        logger.info("Chart intraday sync: %s", run.message)
    except Exception as exc:
        logger.warning(
            "Chart intraday sync outer error (non-fatal, lanjut sync): %s",
            str(exc)[:150],
        )
        run.status = "SUCCESS"
        run.message = f"PARTIAL (error: {str(exc)[:80]})"
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
    parser.add_argument(
        "--history-batch-size",
        type=int,
        default=50,
        help="Jumlah simbol per batch saat backfill history (default: 50, untuk menghindari rate-limit)",
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
            history_batch_size=args.history_batch_size,
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
            history_batch_size=args.history_batch_size,
        )
        elapsed = time.time() - cycle_start
        sleep_sec = max(args.interval_min * 60 - elapsed, 1)
        time.sleep(sleep_sec)


def _split_into_batches(items: List[str], batch_size: int) -> List[List[str]]:
    safe_batch_size = max(batch_size, 1)
    return [items[i : i + safe_batch_size] for i in range(0, len(items), safe_batch_size)]


if __name__ == "__main__":
    main()
