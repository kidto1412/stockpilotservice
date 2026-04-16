from __future__ import annotations

import hashlib
import logging
from typing import Any, Dict, List

import requests


logger = logging.getLogger("market-sync")


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
        try:
            payload = _request_json(
                url,
                timeout_sec,
                params={"page": page, "pageSize": page_size},
            )
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            # IDX kadang blok query pagination dengan 403, fallback ke mode non-paging.
            if status == 403 and page == 1:
                logger.warning(
                    "IDX pagination diblokir (403) untuk %s. Fallback ke single request non-paging.",
                    url,
                )
                payload = _request_json(url, timeout_sec)
                return _extract_records(payload)

            if status == 403 and all_records:
                logger.warning(
                    "IDX pagination berhenti di page=%s karena 403. Data page sebelumnya tetap dipakai.",
                    page,
                )
                break

            raise

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
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.idx.co.id/",
        "Origin": "https://www.idx.co.id",
    }
    with requests.Session() as session:
        # Warm-up cookie/session agar peluang 403 lebih kecil.
        try:
            session.get("https://www.idx.co.id/", headers=headers, timeout=timeout_sec)
        except requests.RequestException:
            pass

        attempts: List[Dict[str, Any]] = [{"method": "GET", "params": params, "data": None}]

        if params:
            # Fallback varian pagination karena beberapa endpoint IDX sensitif pada nama parameter.
            attempts.extend(
                [
                    {
                        "method": "GET",
                        "params": {
                            "pageNumber": params.get("page"),
                            "pageSize": params.get("pageSize"),
                        },
                        "data": None,
                    },
                    {
                        "method": "GET",
                        "params": {
                            "page": params.get("page"),
                            "length": params.get("pageSize"),
                        },
                        "data": None,
                    },
                    {
                        "method": "POST",
                        "params": None,
                        "data": {
                            "page": params.get("page"),
                            "pageSize": params.get("pageSize"),
                        },
                    },
                ]
            )

        last_error: Exception | None = None
        for attempt in attempts:
            try:
                if attempt["method"] == "POST":
                    response = session.post(
                        url,
                        headers=headers,
                        timeout=timeout_sec,
                        data=attempt["data"],
                    )
                else:
                    response = session.get(
                        url,
                        headers=headers,
                        timeout=timeout_sec,
                        params=attempt["params"],
                    )

                response.raise_for_status()
                return response.json()
            except requests.RequestException as exc:
                last_error = exc
                continue

        if last_error:
            raise last_error

        raise RuntimeError("Gagal request IDX: tidak ada response valid")


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
