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
    Indonesia stocks: IDX:{symbol}
    Fallback endpoints jika primary gagal.
    Stable, stabil tanpa rate-limiting.
    """
    rows: List[Dict[str, Any]] = []
    normalized_symbols = _normalize_symbols(symbols)
    success_count = 0
    failed_count = 0

    for idx, symbol in enumerate(normalized_symbols, start=1):
        try:
            candles = _fetch_symbol_daily_candles(
                symbol=symbol,
                timeout_sec=timeout_sec,
                years=years,
            )
            
            # Normalize to storage format
            for candle in candles:
                try:
                    rows.append({
                        "source": "TRADINGVIEW",
                        "symbol": symbol,
                        "timeframe": "1D",
                        "price_at": candle["price_at"],
                        "open_price": candle.get("open", candle.get("close")),
                        "high_price": candle.get("high", candle.get("close")),
                        "low_price": candle.get("low", candle.get("close")),
                        "close_price": candle.get("close"),
                        "volume": candle.get("volume", 0),
                        "raw_payload": candle,
                    })
                except (ValueError, TypeError, KeyError) as e:
                    logger.debug("Normalize candle error for %s: %s", symbol, str(e)[:50])
                    continue

            if candles:
                success_count += 1
                logger.info(
                    "TradingView chart fetch %d/%d: symbol=%s, rows=%d",
                    idx,
                    len(normalized_symbols),
                    symbol,
                    len(candles),
                )
            else:
                logger.warning(
                    "TradingView chart fetch %d/%d: symbol=%s, no rows available",
                    idx,
                    len(normalized_symbols),
                    symbol,
                )
                failed_count += 1
                
        except Exception as exc:
            failed_count += 1
            logger.debug(
                "TradingView chart skip symbol=%s reason=%s",
                symbol,
                str(exc)[:100],
            )

        # Throttle antar simbol
        if idx < len(normalized_symbols):
            time.sleep(0.5)

    if success_count > 0 or failed_count > 0:
        logger.info(
            "TradingView chart fetch complete: success=%d, failed=%d, total_rows=%d",
            success_count,
            failed_count,
            len(rows),
        )

    return rows


def _fetch_symbol_daily_candles(
    symbol: str,
    timeout_sec: int,
    years: int,
) -> List[Dict[str, Any]]:
    """
    Fetch chart bars untuk 1 simbol dari TradingView menggunakan public endpoint.
    Try berbagai format symbol untuk Indonesia stocks.
    """
    # Calculate time range: from N years ago to now
    now_ts = int(datetime.now(timezone.utc).timestamp())
    from_ts = now_ts - (years * 365 * 24 * 3600)

    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.tradingview.com/",
    }

    # Try berbagai format symbol untuk Indonesia
    symbol_formats = [
        f"IDX:{symbol}",           # Format 1: IDX:BBCA
        f"{symbol}.JK",            # Format 2: BBCA.JK
        symbol,                     # Format 3: BBCA (raw)
    ]

    # Try multiple endpoints
    endpoints = [
        {
            "name": "chart.t (direct)",
            "url": "https://charts-node.tradingview.com/chart.t",
            "method": "GET",
            "parser": _parse_chart_response,
        },
        {
            "name": "scanner snapshot",
            "url": "https://scanner.tradingview.com/chart/snapshot",
            "method": "POST",
            "parser": _parse_scanner_response,
        },
        {
            "name": "fe endpoint",
            "url": "https://tradingview.com/symbols/",
            "method": "GET",
            "parser": _parse_html_chart,
        },
    ]

    for symbol_format in symbol_formats:
        for endpoint in endpoints:
            try:
                if endpoint["method"] == "GET":
                    params = {
                        "symbol": symbol_format,
                        "resolution": "D",
                        "from": from_ts,
                        "to": now_ts,
                    }
                    response = requests.get(
                        endpoint["url"],
                        params=params,
                        headers=headers,
                        timeout=timeout_sec,
                    )
                    if response.status_code == 200:
                        data = response.json()
                        logger.debug(
                            "TradingView %s response keys: %s",
                            endpoint["name"],
                            list(data.keys() if isinstance(data, dict) else []),
                        )
                        candles = endpoint["parser"](data)
                        if candles:
                            logger.debug(
                                "TradingView %s SUCCESS with format %s: %d candles",
                                endpoint["name"],
                                symbol_format,
                                len(candles),
                            )
                            return candles
                else:
                    # POST endpoint
                    payload = {
                        "symbols": [symbol_format],
                        "fields": ["name", "close", "open", "high", "low", "volume", "Datetime"],
                    }
                    response = requests.post(
                        endpoint["url"],
                        json=payload,
                        headers=headers,
                        timeout=timeout_sec,
                    )
                    if response.status_code == 200:
                        data = response.json()
                        logger.debug(
                            "TradingView %s response keys: %s",
                            endpoint["name"],
                            list(data.keys() if isinstance(data, dict) else []),
                        )
                        candles = endpoint["parser"](data)
                        if candles:
                            logger.debug(
                                "TradingView %s SUCCESS with format %s: %d candles",
                                endpoint["name"],
                                symbol_format,
                                len(candles),
                            )
                            return candles
            except Exception as e:
                logger.debug(
                    "TradingView %s with format %s failed: %s",
                    endpoint["name"],
                    symbol_format,
                    str(e)[:80],
                )
                continue

    # No data dari semua endpoint
    logger.debug(
        "TradingView: all endpoints failed for symbol=%s (tried formats: %s)",
        symbol,
        ", ".join(symbol_formats),
    )
    return []


def _convert_taapi_to_candles(data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Convert taapi.io historical data format to candle format."""
    candles = []
    for item in data:
        try:
            candle = {
                "price_at": datetime.fromisoformat(item.get("time", "").replace("Z", "+00:00")),
                "open": float(item.get("open", 0)),
                "high": float(item.get("high", 0)),
                "low": float(item.get("low", 0)),
                "close": float(item.get("close", 0)),
                "volume": int(float(item.get("volume", 0))),
                "timestamp": int(datetime.fromisoformat(item.get("time", "").replace("Z", "+00:00")).timestamp()),
            }
            candles.append(candle)
        except Exception:
            continue
    return candles


def _parse_html_chart(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Parse HTML/web response (not typically used here, but available).
    """
    # For now, just return empty - this is HTML fallback
    return []


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
