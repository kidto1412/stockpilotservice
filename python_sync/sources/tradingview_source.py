from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List

import requests


# Mapping index kolom TradingView scanner agar transform stabil.
TV_COLUMNS = [
    "name",
    "close",
    "volume",
    "RSI",
    "MACD.macd",
    "MACD.signal",
    "EMA20",
    "EMA50",
]


def fetch_tradingview_snapshots(
    symbols: Iterable[str],
    scanner_url: str,
    timeout_sec: int,
) -> List[Dict[str, Any]]:
    symbol_list = [item.upper().replace(".JK", "") for item in symbols]
    if not symbol_list:
        return []

    payload = {
        "symbols": {
            "tickers": [f"IDX:{symbol}" for symbol in symbol_list],
            "query": {"types": []},
        },
        "columns": TV_COLUMNS,
    }

    headers = {
        "Content-Type": "application/json",
        "Origin": "https://www.tradingview.com",
        "Referer": "https://www.tradingview.com/",
    }

    response = requests.post(
        scanner_url,
        json=payload,
        headers=headers,
        timeout=timeout_sec,
    )
    response.raise_for_status()
    data = response.json()

    rows = []
    now = datetime.now(timezone.utc)
    for item in data.get("data", []):
        row = _normalize_row(item, now)
        if row:
            rows.append(row)

    return rows


def _normalize_row(item: Dict[str, Any], snapshot_at: datetime) -> Dict[str, Any] | None:
    symbol_full = item.get("s") or ""
    values = item.get("d") or []

    if not symbol_full or not isinstance(values, list):
        return None

    symbol = symbol_full.split(":")[-1].replace(".JK", "")

    value = lambda idx: values[idx] if len(values) > idx else None

    return {
        "source": "TRADINGVIEW",
        "symbol": symbol,
        "snapshot_at": snapshot_at,
        "close_price": _to_float(value(1)),
        "volume": _to_int(value(2)),
        "rsi": _to_float(value(3)),
        "macd": _to_float(value(4)),
        "macd_signal": _to_float(value(5)),
        "ema20": _to_float(value(6)),
        "ema50": _to_float(value(7)),
        "raw_payload": item,
    }


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None
