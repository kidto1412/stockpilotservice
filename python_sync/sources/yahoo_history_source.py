from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List

import requests


def fetch_yahoo_daily_history(
    symbols: Iterable[str],
    timeout_sec: int,
    years: int,
) -> List[Dict[str, Any]]:
    end_at = datetime.now(timezone.utc)
    start_at = end_at - timedelta(days=max(years, 1) * 365)
    return fetch_yahoo_daily_history_between(symbols, timeout_sec, start_at, end_at)


def fetch_yahoo_daily_history_between(
    symbols: Iterable[str],
    timeout_sec: int,
    start_at: datetime,
    end_at: datetime,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    period1 = int(start_at.timestamp())
    period2 = int(end_at.timestamp())

    for symbol in _normalize_symbols(symbols):
        rows.extend(
            _fetch_symbol_history(
                symbol=symbol,
                timeout_sec=timeout_sec,
                period1=period1,
                period2=period2,
            )
        )

    return rows


def _fetch_symbol_history(
    symbol: str,
    timeout_sec: int,
    period1: int,
    period2: int,
) -> List[Dict[str, Any]]:
    yahoo_symbol = f"{symbol}.JK"
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        f"{yahoo_symbol}?period1={period1}&period2={period2}&interval=1d&events=div%2Csplits"
    )

    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://finance.yahoo.com/",
        "Origin": "https://finance.yahoo.com",
    }

    response = requests.get(url, headers=headers, timeout=timeout_sec)
    response.raise_for_status()
    body = response.json()
    result = body.get("chart", {}).get("result", [None])[0]

    if not result:
        return []

    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    rows: List[Dict[str, Any]] = []
    for i, ts in enumerate(timestamps):
        close = _to_float(closes[i]) if i < len(closes) else None
        if close is None:
            continue

        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        open_price = _to_float(opens[i]) if i < len(opens) else close
        high_price = _to_float(highs[i]) if i < len(highs) else close
        low_price = _to_float(lows[i]) if i < len(lows) else close
        volume = _to_int(volumes[i]) if i < len(volumes) else 0

        rows.append(
            {
                "source": "YAHOO",
                "symbol": symbol,
                "timeframe": "1D",
                "price_at": dt,
                "open_price": open_price,
                "high_price": high_price,
                "low_price": low_price,
                "close_price": close,
                "volume": volume,
                "raw_payload": {
                    "symbol": yahoo_symbol,
                    "timestamp": ts,
                    "open": open_price,
                    "high": high_price,
                    "low": low_price,
                    "close": close,
                    "volume": volume,
                },
            }
        )

    return rows


def _normalize_symbols(symbols: Iterable[str]) -> List[str]:
    return sorted(
        {
            item.upper().strip().replace(".JK", "")
            for item in symbols
            if item and item.strip()
        }
    )


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
