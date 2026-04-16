import os
from dataclasses import dataclass
from typing import List

from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class Settings:
    database_url: str
    tradingview_scanner_url: str
    bisnis_rss_url: str
    request_timeout_sec: int
    sync_interval_min: int
    tradingview_all_page_size: int
    tradingview_all_max_rows: int
    history_backfill_years: int
    history_incremental_days: int
    yahoo_retry_max: int
    yahoo_backoff_base_sec: float
    yahoo_min_delay_sec: float
    yahoo_max_delay_sec: float
    history_batch_size: int


def parse_symbols(raw: str) -> List[str]:
    symbols = [item.strip().upper() for item in raw.split(",") if item.strip()]
    return sorted(set(symbols))


def get_settings() -> Settings:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise ValueError("DATABASE_URL belum di-set")

    return Settings(
        database_url=database_url,
        tradingview_scanner_url=os.getenv(
            "TRADINGVIEW_SCANNER_URL",
            "https://scanner.tradingview.com/indonesia/scan",
        ).strip(),
        bisnis_rss_url=os.getenv(
            "BISNIS_RSS_URL",
            "https://www.bisnis.com/",
        ).strip(),
        request_timeout_sec=int(os.getenv("SYNC_REQUEST_TIMEOUT_SEC", "20")),
        sync_interval_min=int(os.getenv("SYNC_INTERVAL_MIN", "30")),
        tradingview_all_page_size=int(os.getenv("TRADINGVIEW_ALL_PAGE_SIZE", "500")),
        tradingview_all_max_rows=int(os.getenv("TRADINGVIEW_ALL_MAX_ROWS", "3000")),
        history_backfill_years=int(os.getenv("HISTORY_BACKFILL_YEARS", "10")),
        history_incremental_days=int(os.getenv("HISTORY_INCREMENTAL_DAYS", "30")),
        yahoo_retry_max=int(os.getenv("YAHOO_RETRY_MAX", "5")),
        yahoo_backoff_base_sec=float(os.getenv("YAHOO_BACKOFF_BASE_SEC", "1.5")),
        yahoo_min_delay_sec=float(os.getenv("YAHOO_MIN_DELAY_SEC", "0.2")),
        yahoo_max_delay_sec=float(os.getenv("YAHOO_MAX_DELAY_SEC", "0.8")),
        history_batch_size=int(os.getenv("HISTORY_BATCH_SIZE", "50")),
    )
