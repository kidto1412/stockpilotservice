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
    all_page_size: int = 500,
    all_max_rows: int = 3000,
) -> List[Dict[str, Any]]:
    symbol_list = [item.upper().replace(".JK", "") for item in symbols]

    headers = {
        "Content-Type": "application/json",
        "Origin": "https://www.tradingview.com",
        "Referer": "https://www.tradingview.com/",
    }

    if symbol_list:
        payload = {
            "symbols": {
                "tickers": [f"IDX:{symbol}" for symbol in symbol_list],
                "query": {"types": []},
            },
            "columns": TV_COLUMNS,
        }
        data_items = _post_scan(scanner_url, payload, headers, timeout_sec)
    else:
        data_items = _scan_all_idx_stocks(
            scanner_url=scanner_url,
            headers=headers,
            timeout_sec=timeout_sec,
            page_size=all_page_size,
            max_rows=all_max_rows,
        )

    rows = []
    now = datetime.now(timezone.utc)
    for item in data_items:
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


def _scan_all_idx_stocks(
    scanner_url: str,
    headers: Dict[str, str],
    timeout_sec: int,
    page_size: int,
    max_rows: int,
) -> List[Dict[str, Any]]:
    all_items: List[Dict[str, Any]] = []
    start = 0
    safe_page_size = max(page_size, 50)
    safe_max_rows = max(max_rows, safe_page_size)

    while start < safe_max_rows:
        end = min(start + safe_page_size - 1, safe_max_rows - 1)
        payload = {
            "filter": [
                {"left": "type", "operation": "equal", "right": "stock"},
            ],
            "range": [start, end],
            "columns": TV_COLUMNS,
        }
        batch = _post_scan(scanner_url, payload, headers, timeout_sec)
        if not batch:
            break

        all_items.extend(batch)
        if len(batch) < safe_page_size:
            break

        start += safe_page_size

    return all_items


def _post_scan(
    scanner_url: str,
    payload: Dict[str, Any],
    headers: Dict[str, str],
    timeout_sec: int,
) -> List[Dict[str, Any]]:
    response = requests.post(
        scanner_url,
        json=payload,
        headers=headers,
        timeout=timeout_sec,
    )
    response.raise_for_status()
    data = response.json()

    raw_items = data.get("data", [])
    return [item for item in raw_items if isinstance(item, dict)]


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
