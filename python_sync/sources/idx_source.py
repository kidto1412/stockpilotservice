from __future__ import annotations

import hashlib
from typing import Any, Dict, List

import requests


def fetch_idx_corporate_actions(url: str, timeout_sec: int) -> List[Dict[str, Any]]:
    data = _request_json(url, timeout_sec)
    records = _extract_records(data)

    results: List[Dict[str, Any]] = []
    for rec in records:
        symbol = _first_non_empty(rec, ["KodeEmiten", "Symbol", "symbol", "ticker"])
        title = _first_non_empty(
            rec,
            [
                "Judul",
                "Title",
                "NamaKegiatan",
                "AnnouncementTitle",
                "headline",
            ],
        )
        if not title:
            continue

        results.append(
            {
                "source": "IDX",
                "event_type": "CORPORATE_ACTION",
                "dedup_key": _build_dedup_key(rec),
                "symbol": symbol,
                "title": title,
                "event_date": _first_non_empty(
                    rec,
                    ["Tanggal", "Date", "AnnouncementDate", "eventDate", "published_at"],
                ),
                "reference_url": _first_non_empty(rec, ["Url", "Link", "reference", "url"]),
                "external_id": str(
                    _first_non_empty(rec, ["Id", "ID", "id", "AnnouncementId"]) or ""
                )
                or None,
                "raw_payload": rec,
            }
        )

    return results


def fetch_idx_news(url: str, timeout_sec: int) -> List[Dict[str, Any]]:
    data = _request_json(url, timeout_sec)
    records = _extract_records(data)

    results: List[Dict[str, Any]] = []
    for rec in records:
        title = _first_non_empty(rec, ["Judul", "Title", "headline", "title"])
        if not title:
            continue

        results.append(
            {
                "source": "IDX",
                "event_type": "OFFICIAL_NEWS",
                "dedup_key": _build_dedup_key(rec),
                "symbol": _first_non_empty(rec, ["KodeEmiten", "Symbol", "symbol", "ticker"]),
                "title": title,
                "event_date": _first_non_empty(rec, ["Tanggal", "Date", "published_at"]),
                "reference_url": _first_non_empty(rec, ["Url", "Link", "url"]),
                "external_id": str(_first_non_empty(rec, ["Id", "ID", "id"]) or "") or None,
                "raw_payload": rec,
            }
        )

    return results


def _request_json(url: str, timeout_sec: int) -> Any:
    headers = {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (compatible; StockPilotSync/1.0)",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.idx.co.id/",
        "Origin": "https://www.idx.co.id",
    }
    response = requests.get(url, headers=headers, timeout=timeout_sec)
    response.raise_for_status()
    return response.json()


def _extract_records(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]

    if not isinstance(payload, dict):
        return []

    candidate_keys = ["data", "Data", "result", "Result", "results", "items", "Items"]
    for key in candidate_keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]

    return []


def _first_non_empty(record: Dict[str, Any], keys: List[str]) -> Any:
    for key in keys:
        value = record.get(key)
        if value is not None and str(value).strip() != "":
            return value
    return None


def _build_dedup_key(record: Dict[str, Any]) -> str:
    ext_id = _first_non_empty(record, ["Id", "ID", "id", "AnnouncementId"])
    url = _first_non_empty(record, ["Url", "Link", "reference", "url"])
    title = _first_non_empty(record, ["Judul", "Title", "headline", "title"])

    base = str(ext_id or url or title or "").strip()
    if base:
        return base

    # Fallback final jika data minim agar row tetap punya key unik deterministik.
    digest = hashlib.sha256(str(sorted(record.items())).encode("utf-8")).hexdigest()
    return digest
