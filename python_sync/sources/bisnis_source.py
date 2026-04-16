"""
Fetch news/event dari Bisnis.com HTML pages.
Normalize ke format market_event_official dengan event_type=NEWS.
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from typing import Any, Dict, List, Tuple
from urllib.parse import urljoin, urlparse

import requests

logger = logging.getLogger("market-sync")


def fetch_bisnis_news(
    rss_url: str = "https://www.bisnis.com/",
    timeout_sec: int = 20,
) -> List[Dict[str, Any]]:
    """
    Fetch news dari Bisnis.com HTML.
    Extract symbols dari title/text, normalize to DB format.
    """
    logger.info("Fetching Bisnis.com HTML: %s", rss_url)

    pages = [
        rss_url,
        "https://market.bisnis.com/",
        "https://finansial.bisnis.com/",
    ]

    rows: List[Dict[str, Any]] = []

    seen_links: set[str] = set()
    for page_url in pages:
        try:
            response = requests.get(
                page_url,
                timeout=timeout_sec,
                headers={"User-Agent": "Mozilla/5.0 StockPilotService/1.0"},
            )
            response.raise_for_status()
        except Exception as exc:
            logger.warning("Skip Bisnis page %s: %s", page_url, exc)
            continue

        parser = BisnisLinkParser(base_url=page_url)
        parser.feed(response.text)
        candidates = parser.candidates
        logger.info("Bisnis page %s found %d candidate links", page_url, len(candidates))

        for title, link, context_text in candidates:
            try:
                normalized_link = urljoin(page_url, link)
                if normalized_link in seen_links:
                    continue
                seen_links.add(normalized_link)

                if not is_relevant_bisnis_link(normalized_link):
                    continue

                # Skip category pages, focus on article pages.
                if "/read/" not in normalized_link:
                    continue

                symbols = extract_symbols(f"{title} {context_text}")
                event_date = guess_event_date_from_url(normalized_link)
                dedup_key = hashlib.sha256(normalized_link.encode()).hexdigest()[:16]

                symbol_values = symbols if symbols else [None]
                for symbol in symbol_values:
                    rows.append(
                        {
                            "source": "BISNIS_COM",
                            "event_type": "OFFICIAL_NEWS",
                            "dedup_key": f"{dedup_key}_{symbol or 'GENERAL'}",
                            "symbol": symbol,
                            "title": title,
                            "event_date": event_date,
                            "reference_url": normalized_link,
                            "external_id": normalized_link,
                            "raw_payload": {
                                "url": normalized_link,
                                "title": title,
                                "context": context_text[:1000],
                                "source_page": page_url,
                                "symbols": symbols,
                            },
                        }
                    )
            except Exception as exc:
                logger.warning("Skip entry (error): %s", exc)
                continue

    logger.info("Bisnis RSS normalized %d news items", len(rows))
    return rows


class BisnisLinkParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__()
        self.base_url = base_url
        self.candidates: List[Tuple[str, str, str]] = []
        self._current_href: str | None = None
        self._current_text: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        attr_map = {key.lower(): value for key, value in attrs}
        href = attr_map.get("href")
        if href:
            self._current_href = href
            self._current_text = []

    def handle_data(self, data: str) -> None:
        if self._current_href is not None:
            self._current_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or self._current_href is None:
            return
        text = clean_text(" ".join(self._current_text))
        href = self._current_href.strip()
        self._current_href = None
        self._current_text = []

        if not text or len(text) < 12:
            return

        self.candidates.append((text, href, text))


def clean_text(text: str) -> str:
    text = unescape(text or "")
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def is_relevant_bisnis_link(url: str) -> bool:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    return host.endswith("bisnis.com") and "/read/" in parsed.path


def guess_event_date_from_url(url: str) -> datetime | None:
    match = re.search(r"/read/(\d{4})(\d{2})(\d{2})/", url)
    if not match:
        return None
    year, month, day = map(int, match.groups())
    return datetime(year, month, day, tzinfo=timezone.utc)


def extract_symbols(text: str) -> List[str]:
    """
    Extract saham symbols dari text.
    Pattern: 4 uppercase letters (BBCA, TLKM, ASII, etc)
    Exclude common words: THAT, DARI, WILL, etc
    """
    pattern = r"\b([A-Z]{4})\b"
    matches = re.findall(pattern, text)

    # Filter common non-symbol words
    exclude = {"DARI", "YANG", "AKAN", "TELAH", "DAPAT", "HARUS", "PADA", "JUGA"}
    symbols = [m.upper() for m in matches if m.upper() not in exclude]

    return list(dict.fromkeys(symbols))  # Deduplicate, preserve order


def parse_published_date(date_str: str) -> datetime | None:
    """
    Parse published date dari RSS entry.
    RSS format: 'Wed, 15 Apr 2026 10:30:00 GMT'
    """
    if not date_str:
        return None

    # Try common formats
    formats = [
        "%a, %d %b %Y %H:%M:%S %Z",
        "%a, %d %b %Y %H:%M:%S GMT",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S",
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            # Ensure UTC
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue

    logger.warning("Could not parse date: %s", date_str)
    return None
