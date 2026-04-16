import os
from dataclasses import dataclass
from typing import List

from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class Settings:
    database_url: str
    tradingview_scanner_url: str
    idx_corporate_action_url: str
    idx_news_url: str
    request_timeout_sec: int
    sync_interval_min: int


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
        idx_corporate_action_url=os.getenv(
            "IDX_CORPORATE_ACTION_URL",
            "https://www.idx.co.id/primary/ListedCompany/GetCompanyAnnouncement",
        ).strip(),
        idx_news_url=os.getenv(
            "IDX_NEWS_URL",
            "https://www.idx.co.id/primary/ListedCompany/GetPressRelease",
        ).strip(),
        request_timeout_sec=int(os.getenv("SYNC_REQUEST_TIMEOUT_SEC", "20")),
        sync_interval_min=int(os.getenv("SYNC_INTERVAL_MIN", "30")),
    )
