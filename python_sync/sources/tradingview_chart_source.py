from __future__ import annotations

import json
import logging
import os
import random
import re
import string
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

import websocket


logger = logging.getLogger("market-sync")

_WS_URL = "wss://data.tradingview.com/socket.io/websocket"
_WS_TIMEOUT_SEC = 20
_RE_TV_MESSAGE = re.compile(r"~m~\d+~m~")
_RE_SERIES_JSON = re.compile(r'\"s\":\[(.+?)\]\}\]')


def fetch_tradingview_daily_candles(
    symbols: list[str],
    timeout_sec: int,
    years: int,
) -> List[Dict[str, Any]]:
    """
    Ambil candle harian multi-tahun dari TradingView via WebSocket chart-session.
    Ini jalur yang dipakai web chart TradingView, bukan endpoint scanner/snapshot.
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

            if candles:
                rows.extend(_to_db_rows(symbol, candles))
                success_count += 1
                logger.info(
                    "TradingView chart fetch %d/%d: symbol=%s, rows=%d",
                    idx,
                    len(normalized_symbols),
                    symbol,
                    len(candles),
                )
            else:
                failed_count += 1
                logger.warning(
                    "TradingView chart fetch %d/%d: symbol=%s, no rows available",
                    idx,
                    len(normalized_symbols),
                    symbol,
                )
        except Exception as exc:
            failed_count += 1
            logger.warning(
                "TradingView chart skip symbol=%s reason=%s",
                symbol,
                str(exc)[:120],
            )

        if idx < len(normalized_symbols):
            time.sleep(0.25)

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
    Ambil candle harian dari WebSocket TradingView untuk satu simbol.
    """
    # TradingView Indonesia stocks di chart memakai prefix IDX:
    tv_symbol = f"IDX:{symbol}"

    chart_session = _random_session("cs")
    quote_session = _random_session("qs")

    ws = websocket.create_connection(
        _WS_URL,
        timeout=max(timeout_sec, _WS_TIMEOUT_SEC),
        header=_build_ws_headers(),
    )

    try:
        _send_tv_message(ws, "set_auth_token", ["unauthorized_user_token"])
        _send_tv_message(ws, "chart_create_session", [chart_session, ""])
        _send_tv_message(ws, "quote_create_session", [quote_session])
        _send_tv_message(ws, "quote_set_fields", [
            quote_session,
            "ch",
            "chp",
            "current_session",
            "description",
            "exchange",
            "format",
            "fractional",
            "is_tradable",
            "language",
            "local_description",
            "lp",
            "lp_time",
            "minmov",
            "minmove2",
            "original_name",
            "pricescale",
            "pro_name",
            "short_name",
            "type",
            "update_mode",
            "volume",
            "currency_code",
            "rchp",
            "rtc",
        ])
        _send_tv_message(ws, "quote_add_symbols", [quote_session, tv_symbol, {"flags": ["force_permission"]}])

        _send_tv_message(ws, "resolve_symbol", [chart_session, "symbol_1", json.dumps({"symbol": tv_symbol, "adjustment": "splits", "session": "regular"})])

        # 1D resolution, request enough bars for N years.
        # Gunakan 390 hari/tahun untuk cover hari bursa + buffer split/holiday.
        bars = max(400, years * 390)
        _send_tv_message(ws, "create_series", [chart_session, "s1", "s1", "symbol_1", "1D", bars])

        raw = _read_ws_until_series(ws, timeout_sec=max(timeout_sec, _WS_TIMEOUT_SEC))
        candles = _parse_ws_series(raw)
        return candles
    finally:
        try:
            ws.close()
        except Exception:
            pass


def _to_db_rows(symbol: str, candles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for candle in candles:
        close = candle.get("close")
        if close is None:
            continue
        rows.append(
            {
                "source": "TRADINGVIEW",
                "symbol": symbol,
                "timeframe": "1D",
                "price_at": candle["price_at"],
                "open_price": candle.get("open", close),
                "high_price": candle.get("high", close),
                "low_price": candle.get("low", close),
                "close_price": close,
                "volume": candle.get("volume", 0),
                "raw_payload": candle,
            }
        )
    return rows


def _send_tv_message(ws: websocket.WebSocket, method: str, params: List[Any]) -> None:
    payload = json.dumps({"m": method, "p": params}, separators=(",", ":"))
    framed = f"~m~{len(payload)}~m~{payload}"
    ws.send(framed)


def _read_ws_until_series(ws: websocket.WebSocket, timeout_sec: int) -> str:
    ws.settimeout(timeout_sec)
    started = time.time()
    chunks: List[str] = []

    while time.time() - started < timeout_sec:
        data = ws.recv()
        if not data:
            continue

        chunks.append(data)
        merged = "\n".join(chunks)

        # Ketika series ter-load, message biasanya mengandung pattern "s":[...]
        if "timescale_update" in merged and '"s":[' in merged:
            return merged
        if "series_completed" in merged and '"s":[' in merged:
            return merged

    return "\n".join(chunks)


def _parse_ws_series(raw: str) -> List[Dict[str, Any]]:
    candles: List[Dict[str, Any]] = []
    if not raw:
        return candles

    text = _RE_TV_MESSAGE.sub("", raw)
    match = _RE_SERIES_JSON.search(text)
    if not match:
        return candles

    series_blob = match.group(1)

    # Format item umumnya: {"i":0,"v":[ts,open,high,low,close,volume]}
    for item in re.finditer(r"\{\"i\":\d+,\"v\":\[(.*?)\]\}", series_blob):
        values = item.group(1).split(",")
        if len(values) < 5:
            continue

        try:
            ts = int(float(values[0]))
            open_price = float(values[1])
            high_price = float(values[2])
            low_price = float(values[3])
            close_price = float(values[4])
            volume = float(values[5]) if len(values) > 5 else 0.0

            if close_price <= 0:
                continue

            candles.append(
                {
                    "timestamp": ts,
                    "price_at": datetime.fromtimestamp(ts, tz=timezone.utc),
                    "open": open_price,
                    "high": high_price,
                    "low": low_price,
                    "close": close_price,
                    "volume": int(volume),
                }
            )
        except (ValueError, TypeError):
            continue

    return candles


def _random_session(prefix: str) -> str:
    suffix = "".join(random.choices(string.ascii_lowercase, k=12))
    return f"{prefix}_{suffix}"


def _normalize_symbols(symbols: list[str]) -> List[str]:
    return sorted(
        {
            item.upper().strip().replace(".JK", "")
            for item in symbols
            if item and item.strip()
        }
    )


def _build_ws_headers() -> List[str]:
    headers = [
        "Origin: https://www.tradingview.com",
        "User-Agent: Mozilla/5.0",
    ]
    cookie = os.getenv("TRADINGVIEW_COOKIE", "").strip()
    if cookie:
        headers.append(f"Cookie: {cookie}")
    return headers
