from __future__ import annotations

import logging
import random
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List

import requests


logger = logging.getLogger("market-sync")


def fetch_yahoo_daily_history(
    symbols: Iterable[str],
    timeout_sec: int,
    years: int,
    retry_max: int = 5,
    min_delay_sec: float = 0.2,
    max_delay_sec: float = 1.0,
    backoff_base_sec: float = 1.5,
) -> List[Dict[str, Any]]:
    end_at = datetime.now(timezone.utc)
    start_at = end_at - timedelta(days=max(years, 1) * 365)
    return fetch_yahoo_daily_history_between(
        symbols,
        timeout_sec,
        start_at,
        end_at,
        retry_max=retry_max,
        min_delay_sec=min_delay_sec,
        max_delay_sec=max_delay_sec,
        backoff_base_sec=backoff_base_sec,
    )


def fetch_yahoo_daily_history_between(
    symbols: Iterable[str],
    timeout_sec: int,
    start_at: datetime,
    end_at: datetime,
    retry_max: int = 5,
    min_delay_sec: float = 0.2,
    max_delay_sec: float = 1.0,
    backoff_base_sec: float = 1.5,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    period1 = int(start_at.timestamp())
    period2 = int(end_at.timestamp())
    normalized_symbols = _normalize_symbols(symbols)

    failed_symbols = 0
    for idx, symbol in enumerate(normalized_symbols, start=1):
        try:
            rows.extend(
                _fetch_symbol_history(
                    symbol=symbol,
                    timeout_sec=timeout_sec,
                    period1=period1,
                    period2=period2,
                    retry_max=retry_max,
                    backoff_base_sec=backoff_base_sec,
                )
            )
        except Exception as exc:
            failed_symbols += 1
            logger.warning(
                "Yahoo history skip symbol=%s reason=%s",
                symbol,
                str(exc),
            )

        # Throttle antar simbol agar tidak banjir request dan mengurangi 429.
        if idx < len(normalized_symbols):
            _sleep_random(min_delay_sec, max_delay_sec)

    if failed_symbols:
        logger.warning(
            "Yahoo history selesai dengan partial failure: failed=%s success=%s",
            failed_symbols,
            len(normalized_symbols) - failed_symbols,
        )

    return rows


def _fetch_symbol_history(
    symbol: str,
    timeout_sec: int,
    period1: int,
    period2: int,
    retry_max: int,
    backoff_base_sec: float,
) -> List[Dict[str, Any]]:
    yahoo_symbol = f"{symbol}.JK"
    urls = [
        (
            "https://query1.finance.yahoo.com/v8/finance/chart/"
            f"{yahoo_symbol}?period1={period1}&period2={period2}&interval=1d&events=div%2Csplits"
        ),
        (
            "https://query2.finance.yahoo.com/v8/finance/chart/"
            f"{yahoo_symbol}?period1={period1}&period2={period2}&interval=1d&events=div%2Csplits"
        ),
    ]

    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://finance.yahoo.com/",
        "Origin": "https://finance.yahoo.com",
    }

    response = _fetch_with_retry(
        urls=urls,
        headers=headers,
        timeout_sec=timeout_sec,
        retry_max=retry_max,
        backoff_base_sec=backoff_base_sec,
    )
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


def _fetch_with_retry(
    urls: List[str],
    headers: Dict[str, str],
    timeout_sec: int,
    retry_max: int,
    backoff_base_sec: float,
) -> requests.Response:
    last_error: Exception | None = None

    safe_retry_max = max(retry_max, 1)
    for attempt in range(1, safe_retry_max + 1):
        for url in urls:
            try:
                response = requests.get(url, headers=headers, timeout=timeout_sec)
                if response.status_code == 429:
                    wait_sec = _calc_backoff_wait(attempt, backoff_base_sec)
                    logger.info(
                        "Yahoo 429 url=%s attempt=%s/%s wait=%.2fs",
                        url,
                        attempt,
                        safe_retry_max,
                        wait_sec,
                    )
                    time.sleep(wait_sec)
                    continue

                response.raise_for_status()
                return response
            except requests.RequestException as exc:
                last_error = exc

        wait_sec = _calc_backoff_wait(attempt, backoff_base_sec)
        time.sleep(wait_sec)

    if last_error:
        raise last_error

    raise RuntimeError("Yahoo request failed without response")


def _calc_backoff_wait(attempt: int, base_sec: float) -> float:
    safe_base = max(base_sec, 0.5)
    return min((safe_base ** max(attempt - 1, 0)) + random.uniform(0.1, 0.9), 20.0)


def _sleep_random(min_delay_sec: float, max_delay_sec: float) -> None:
    low = max(min_delay_sec, 0.0)
    high = max(max_delay_sec, low)
    time.sleep(random.uniform(low, high))


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
