"""
Fetch news dari Bisnis.com RSS feed.
Normalize ke format market_event_official dengan event_type=NEWS.
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List
from urllib.parse import urlparse

import feedparser

logger = logging.getLogger("market-sync")


def fetch_bisnis_news(
    rss_url: str = "https://bisnis.com/feed/rss.xml",
    timeout_sec: int = 20,
) -> List[Dict[str, Any]]:
    """
    Fetch news dari Bisnis.com RSS feed.
    Extract symbols dari title/description, normalize to DB format.
    """
    logger.info("Fetching Bisnis.com RSS: %s", rss_url)

    try:
        feed = feedparser.parse(rss_url)
    except Exception as exc:
        logger.error("Bisnis RSS parse gagal: %s", exc)
        raise

    if feed.bozo and feed.bozo_exception:
        logger.warning("RSS parse warning: %s", feed.bozo_exception)

    entries = feed.get("entries", [])
    logger.info("Bisnis RSS ditemukan %d entries", len(entries))

    rows: List[Dict[str, Any]] = []

    for entry in entries:
        try:
            title: str = entry.get("title", "").strip()
            link: str = entry.get("link", "").strip()
            published: str = entry.get("published", "").strip()
            summary: str = entry.get("summary", "").strip()

            if not title or not link:
                continue

            # Extract symbols dari title + summary
            # Pattern: BBCA, TLKM, ASII, dsb (4 huruf uppercase)
            symbols = extract_symbols(title + " " + summary)

            # Parse date
            event_date = parse_published_date(published)

            # Dedup key: hash dari URL atau title
            dedup_key = hashlib.sha256(link.encode()).hexdigest()[:16]

            # Untuk setiap symbol ditemukan, buat satu row event
            if symbols:
                for symbol in symbols:
                    row: Dict[str, Any] = {
                        "source": "BISNIS_COM",
                        "event_type": "NEWS",
                        "dedup_key": f"{dedup_key}_{symbol}",
                        "symbol": symbol,
                        "title": title,
                        "event_date": event_date,
                        "reference_url": link,
                        "external_id": link,
                        "raw_payload": {
                            "url": link,
                            "published": published,
                            "summary": summary[:500],  # Limit summary
                            "source_feed": "bisnis.com",
                        },
                    }
                    rows.append(row)
            else:
                # Jika tidak ada symbol, skip (atau record dengan symbol=NULL)
                logger.debug("No symbols found in: %s", title)

        except Exception as exc:
            logger.warning("Skip entry (error): %s", exc)
            continue

    logger.info("Bisnis RSS normalized %d news items", len(rows))
    return rows


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
