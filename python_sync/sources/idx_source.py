from __future__ import annotations

import hashlib
from typing import Any, Dict, List

import requests


def fetch_idx_corporate_actions(
    url: str,
    timeout_sec: int,
    full_sync: bool = False,
    max_pages: int = 1,
    page_size: int = 100,
) -> List[Dict[str, Any]]:
    records = _fetch_records(url, timeout_sec, full_sync, max_pages, page_size)

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


def fetch_idx_news(
    url: str,
    timeout_sec: int,
    full_sync: bool = False,
    max_pages: int = 1,
    page_size: int = 100,
) -> List[Dict[str, Any]]:
    records = _fetch_records(url, timeout_sec, full_sync, max_pages, page_size)

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


def _fetch_records(
    url: str,
    timeout_sec: int,
    full_sync: bool,
    max_pages: int,
    page_size: int,
) -> List[Dict[str, Any]]:
    if not full_sync:
        payload = _request_json(url, timeout_sec)
        return _extract_records(payload)

    all_records: List[Dict[str, Any]] = []
    seen_page_fingerprints = set()

    for page in range(1, max(max_pages, 1) + 1):
        payload = _request_json(
            url,
            timeout_sec,
            params={"page": page, "pageSize": page_size},
        )
        page_records = _extract_records(payload)
        if not page_records:
            break

        fingerprint = _build_page_fingerprint(page_records)
        if fingerprint in seen_page_fingerprints:
            break

        seen_page_fingerprints.add(fingerprint)
        all_records.extend(page_records)

        # Beberapa endpoint berhenti saat jumlah record < pageSize.
        if len(page_records) < page_size:
            break

    return all_records


def _request_json(url: str, timeout_sec: int, params: Dict[str, Any] | None = None) -> Any:
    headers = {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (compatible; StockPilotSync/1.0)",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.idx.co.id/",
        "Origin": "https://www.idx.co.id",
    }
    response = requests.get(url, headers=headers, timeout=timeout_sec, params=params)
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


def _build_page_fingerprint(records: List[Dict[str, Any]]) -> str:
    sample = records[:5]
    digest = hashlib.sha256(str(sample).encode("utf-8")).hexdigest()
    return digest
