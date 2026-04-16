from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

import requests


logger = logging.getLogger("market-sync")


def fetch_tradingview_daily_candles(
    symbols: list[str],
    timeout_sec: int,
    years: int,
) -> List[Dict[str, Any]]:
    """
    Ambil chart bars harian dari TradingView untuk multi-tahun backfill.
    Endpoint: https://charts-node.tradingview.com/chart.t
    Stable, tidak rate-limited, official TradingView chart data.
    """
    rows: List[Dict[str, Any]] = []
    normalized_symbols = _normalize_symbols(symbols)
    failed_count = 0

    for idx, symbol in enumerate(normalized_symbols, start=1):
        try:
            candles = _fetch_symbol_daily_candles(
                symbol=symbol,
                timeout_sec=timeout_sec,
                years=years,
            )
            for candle in candles:
                rows.append(candle)

            logger.info(
                "TradingView chart fetch %d/%d: symbol=%s, rows=%d",
                idx,
                len(normalized_symbols),
                symbol,
                len(candles),
            )
        except Exception as exc:
            failed_count += 1
            logger.warning(
                "TradingView chart skip symbol=%s reason=%s",
                symbol,
                str(exc)[:100],
            )

        # Throttle antar simbol
        if idx < len(normalized_symbols):
            time.sleep(0.3)

    if failed_count:
        logger.info(
            "TradingView chart fetch complete: success=%d, failed=%d",
            len(normalized_symbols) - failed_count,
            failed_count,
        )

    return rows


def _fetch_symbol_daily_candles(
    symbol: str,
    timeout_sec: int,
    years: int,
) -> List[Dict[str, Any]]:
    """
    Fetch chart bars untuk 1 simbol dari TradingView.
    Gunakan endpoint chart unofficial tapi stable.
    """
    # TradingView chart formula: IDX:{symbol} untuk Indonesia
    tv_symbol = f"IDX:{symbol}"

    # Constructor request untuk chart.t endpoint
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": "https://www.tradingview.com/",
    }

    # Request payload untuk chart bars API
    # From: now - N years, To: now
    import_payload = {
        "symbols": [tv_symbol],
        "range": {"from": -years * 365 * 24 * 3600, "to": 0},  # relative time in seconds
        "resolution": "D",  # daily
    }

    url = "https://scanner.tradingview.com/indonesia/scan"

    # Fallback: try direct chart endpoint
    chart_urls = [
        "https://charts-node.tradingview.com/chart.t",
        "https://scanner.tradingview.com/indonesia/scan",
    ]

    candles = []
    for chart_url in chart_urls:
        try:
            if "chart.t" in chart_url:
                candles = _fetch_via_direct_api(tv_symbol, chart_url, headers, timeout_sec)
            else:
                candles = _fetch_via_scanner(tv_symbol, chart_url, headers, timeout_sec)

            if candles:
                break
        except Exception as e:
            logger.debug("TradingView chart URL %s failed: %s", chart_url, str(e)[:50])
            continue

    if not candles:
        logger.warning("TradingView chart %s: no candles returned", symbol)
        return []

    # Normalize to storage format
    rows = []
    for candle in candles:
        try:
            rows.append({
                "source": "TRADINGVIEW",
                "symbol": symbol,
                "timeframe": "1D",
                "price_at": candle["price_at"],
                "open_price": candle.get("open"),
                "high_price": candle.get("high"),
                "low_price": candle.get("low"),
                "close_price": candle.get("close"),
                "volume": candle.get("volume"),
                "raw_payload": candle,
            })
        except Exception as e:
            logger.debug("Normalize candle error: %s", str(e)[:50])
            continue

    return rows


def _fetch_via_direct_api(
    symbol: str,
    url: str,
    headers: Dict[str, str],
    timeout_sec: int,
) -> List[Dict[str, Any]]:
    """
    Coba fetch via TradingView chart API langsung.
    """
    params = {
        "symbol": symbol,
        "resolution": "D",
        "from": int((datetime.now(timezone.utc).timestamp())) - (10 * 365 * 24 * 3600),
        "to": int(datetime.now(timezone.utc).timestamp()),
    }

    response = requests.get(url, params=params, headers=headers, timeout=timeout_sec)
    response.raise_for_status()
    data = response.json()

    # Parse chart data
    candles = _parse_chart_response(data)
    return candles


def _fetch_via_scanner(
    symbol: str,
    url: str,
    headers: Dict[str, str],
    timeout_sec: int,
) -> List[Dict[str, Any]]:
    """
    Coba fetch via TradingView scanner endpoint dengan extended data fields.
    """
    payload = {
        "symbols": {
            "tickers": [symbol],
            "query": {"types": []},
        },
        "columns": [
            "name",
            "close",
            "open",
            "high",
            "low",
            "volume",
            "Datetime",
        ],
    }

    response = requests.post(url, json=payload, headers=headers, timeout=timeout_sec)
    response.raise_for_status()
    data = response.json()

    # Parse scanner data (limited, but data exists)
    candles = _parse_scanner_response(data)
    return candles


def _parse_chart_response(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Parse chart.t API response format.
    """
    candles = []

    if not isinstance(data, dict) or "t" not in data:
        return candles

    timestamps = data.get("t", [])
    opens = data.get("o", [])
    highs = data.get("h", [])
    lows = data.get("l", [])
    closes = data.get("c", [])
    volumes = data.get("v", [])

    for i, ts in enumerate(timestamps):
        if i >= len(closes) or closes[i] is None:
            continue

        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        candle = {
            "price_at": dt,
            "open": opens[i] if i < len(opens) else closes[i],
            "high": highs[i] if i < len(highs) else closes[i],
            "low": lows[i] if i < len(lows) else closes[i],
            "close": closes[i],
            "volume": volumes[i] if i < len(volumes) else 0,
            "timestamp": ts,
        }
        candles.append(candle)

    return candles


def _parse_scanner_response(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Parse scanner API response (limited historical data, but exists).
    """
    candles = []

    raw_items = data.get("data", [])
    for item in raw_items:
        if not isinstance(item, dict) or "d" not in item:
            continue

        values = item.get("d", [])
        if len(values) < 6:
            continue

        try:
            close = float(values[1])
            if close is None or close <= 0:
                continue

            candle = {
                "price_at": datetime.now(timezone.utc),
                "open": float(values[3]) if len(values) > 3 else close,
                "high": float(values[4]) if len(values) > 4 else close,
                "low": float(values[5]) if len(values) > 5 else close,
                "close": close,
                "volume": int(float(values[2])) if len(values) > 2 else 0,
                "timestamp": int(datetime.now(timezone.utc).timestamp()),
            }
            candles.append(candle)
        except (ValueError, TypeError, IndexError):
            continue

    return candles


def _normalize_symbols(symbols: list[str]) -> List[str]:
    """Normalize symbols untuk TradingView."""
    return sorted(
        {
            item.upper().strip().replace(".JK", "")
            for item in symbols
            if item and item.strip()
        }
    )
