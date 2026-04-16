"""
Fetch news dari Bisnis.com RSS feed.
Normalize ke format market_event_official dengan event_type=NEWS.
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone
from html import unescape
from typing import Any, Dict, List
from xml.etree import ElementTree as ET

import requests

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

    response = requests.get(
        rss_url,
        timeout=timeout_sec,
        headers={"User-Agent": "Mozilla/5.0 StockPilotService/1.0"},
    )
    response.raise_for_status()

    xml_text = sanitize_xml(response.text)
    root = ET.fromstring(xml_text)
    items = root.findall(".//item")
    logger.info("Bisnis RSS ditemukan %d entries", len(items))

    rows: List[Dict[str, Any]] = []

    for item in items:
        try:
            title = clean_text(get_child_text(item, "title"))
            link = clean_text(get_child_text(item, "link"))
            published = clean_text(get_child_text(item, "pubDate") or get_child_text(item, "published"))
            summary = clean_text(get_child_text(item, "description") or get_child_text(item, "summary"))

            if not title or not link:
                continue

            symbols = extract_symbols(f"{title} {summary}")
            event_date = parse_published_date(published)
            dedup_key = hashlib.sha256(link.encode()).hexdigest()[:16]

            symbol_values = symbols if symbols else [None]
            for symbol in symbol_values:
                rows.append(
                    {
                        "source": "BISNIS_COM",
                        "event_type": "NEWS",
                        "dedup_key": f"{dedup_key}_{symbol or 'GENERAL'}",
                        "symbol": symbol,
                        "title": title,
                        "event_date": event_date,
                        "reference_url": link,
                        "external_id": link,
                        "raw_payload": {
                            "url": link,
                            "published": published,
                            "summary": summary[:1000],
                            "source_feed": "bisnis.com",
                            "symbols": symbols,
                        },
                    }
                )
        except Exception as exc:
            logger.warning("Skip entry (error): %s", exc)
            continue

    logger.info("Bisnis RSS normalized %d news items", len(rows))
    return rows


def sanitize_xml(xml_text: str) -> str:
    """Bersihkan XML RSS yang kadang mengandung karakter ilegal atau & mentah."""
    cleaned = xml_text.replace("\x00", "")
    cleaned = re.sub(r"[\x01-\x08\x0b\x0c\x0e-\x1f]", "", cleaned)
    cleaned = re.sub(
        r"&(?!amp;|lt;|gt;|apos;|quot;|#\d+;|#x[0-9a-fA-F]+;)",
        "&amp;",
        cleaned,
    )
    return cleaned


def get_child_text(item: ET.Element, tag_name: str) -> str:
    child = item.find(tag_name)
    if child is None or child.text is None:
        return ""
    return child.text


def clean_text(text: str) -> str:
    text = unescape(text or "")
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


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
