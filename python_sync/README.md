# Python Sync Service (TradingView + Bisnis.com RSS)

## Tujuan

- Ambil data teknikal (OHLCV, RSI, MACD, EMA, volume) dari endpoint TradingView scanner.
- Ambil data candle harian historis multi-tahun (default 10 tahun) dari Yahoo Finance chart API.
- Ambil news & artikel dari RSS feed Bisnis.com (gratis unlimited).
- Scan semua saham IDX atau symbols pilihan.
- Simpan ke DB PostgreSQL sendiri (tabel `market_technical_snapshot`, `market_price_history`, `market_event_official`).
- Jalankan sinkronisasi berkala tanpa scraping HTML frontend.

Arsitektur Ringkas

1. **TradingView Scanner source**
   - POST ke `https://scanner.tradingview.com/indonesia/scan`
   - Ambil snapshot teknikal semua saham IDX (kolom: close, volume, RSI, MACD, EMA20, EMA50)
   - Upsert ke: `market_technical_snapshot`

2. **Yahoo History source**
   - GET ke endpoint chart Yahoo Finance
   - Simpan candle OHLCV harian multi-tahun
   - Full sync: backfill default 10 tahun
   - Sync interval: incremental default 30 hari terakhir
   - Upsert ke: `market_price_history`

3. **Bisnis.com RSS source**
   - Fetch RSS dari `https://bisnis.com/feed/rss.xml`
   - Extract symbols dari title/description (pattern: BBCA, TLKM, ASII, dll)
   - Normalize ke format: source=BISNIS_COM, event_type=OFFICIAL_NEWS
   - Upsert ke: `market_event_official`

4. **Storage**
   - `market_technical_snapshot`: teknikal snapshots
   - `market_price_history`: candle history harian
   - `market_event_official`: news & events
   - `sync_run_log`: sync status log per source

5. **Scheduler**
   - Mode sekali jalan (`python sync_market_data.py --full-sync`)
   - Mode interval menit (`python sync_market_data.py --interval-min 15`)
   - Opsional cron/systemd di server

Struktur File

- `sync_market_data.py`: Entrypoint CLI + scheduler loop (TradingView + Bisnis.com)
- `sources/yahoo_history_source.py`: Yahoo chart fetcher untuk candle history harian
- `config.py`: Environment config (DATABASE_URL, endpoint URLs, timeout, interval)
- `db.py`: DDL + upsert operations + sync logging
- `sources/tradingview_source.py`: TradingView scanner request + normalisasi teknikal
- `sources/bisnis_source.py`: Bisnis.com RSS parser + normalisasi news
- `requirements.txt`: Python dependencies (requests, psycopg, python-dotenv)

Persiapan

1. Install dependency
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r python_sync/requirements.txt

2. Pastikan env tersedia
   - DATABASE_URL (wajib - pakai yang sama dengan NestJS)
   - Opsional:
     - TRADINGVIEW_SCANNER_URL (default: https://scanner.tradingview.com/indonesia/scan)
     - BISNIS_RSS_URL (default: https://bisnis.com/feed/rss.xml)
     - SYNC_REQUEST_TIMEOUT_SEC (default: 20 detik)
     - SYNC_INTERVAL_MIN (default: 30 menit)
     - TRADINGVIEW_ALL_PAGE_SIZE (default: 500)
     - TRADINGVIEW_ALL_MAX_ROWS (default: 3000)
   - HISTORY_BACKFILL_YEARS (default: 10)
   - HISTORY_INCREMENTAL_DAYS (default: 30)
   - YAHOO_RETRY_MAX (default: 5)
   - YAHOO_BACKOFF_BASE_SEC (default: 1.5)
   - YAHOO_MIN_DELAY_SEC (default: 0.2)
   - YAHOO_MAX_DELAY_SEC (default: 0.8)
   - HISTORY_BATCH_SIZE (default: 50)

Jalankan Sinkron Sekali (tulisan symbols optional)

```bash
python python_sync/sync_market_data.py --symbols BBCA,TLKM,ASII
```

Jalankan Full Sync Pertama Kali (Semua saham IDX, auto-scan)

```bash
python python_sync/sync_market_data.py --full-sync
```

Jalankan Full Sync + Backfill 15 Tahun

```bash
python python_sync/sync_market_data.py --full-sync --history-years 15
```

Jalankan Full Sync Dengan Auto-Batching (100 simbol/batch)

```bash
python python_sync/sync_market_data.py --full-sync --history-years 10 --history-batch-size 100
```

Jalankan Full Sync Dengan Batching Kecil (25 simbol/batch, untuk server ketat rate-limit)

```bash
python python_sync/sync_market_data.py --full-sync --history-years 10 --history-batch-size 25
```

Jalankan Berkala (setiap 15 menit)

```bash
python python_sync/sync_market_data.py --interval-min 15
```

Jalankan tanpa history (hanya snapshot teknikal + news)

```bash
python python_sync/sync_market_data.py --interval-min 15 --skip-history
```

**Catatan:**

- Jika `--symbols` dikosongkan → auto-scan semua saham IDX
- `--full-sync` → scan semua saham: technical snapshot + latest news dari Bisnis.com
- `--full-sync` → scan semua saham + backfill candle history multi-tahun
- Tanpa `--full-sync`, history tetap diupdate incremental (default 30 hari)

**Contoh Cron (setiap 15 menit, setiap hari):**

```bash
*/15 * * * * cd /Users/user/js_development/StockPilotService && /usr/bin/python3 python_sync/sync_market_data.py >> /tmp/market_sync.log 2>&1
```

**Contoh Cron Jam Market IDX (Senin-Jumat, 09:00-16:15, tiap 15 menit):**

```bash
*/15 9-15 * * 1-5 cd /Users/user/js_development/StockPilotService && /usr/bin/python3 python_sync/sync_market_data.py >> /tmp/market_sync.log 2>&1
0,15 16 * * 1-5 cd /Users/user/js_development/StockPilotService && /usr/bin/python3 python_sync/sync_market_data.py >> /tmp/market_sync.log 2>&1
```

Catatan & Troubleshooting

**TradingView Scanner:**

- Endpoint: `https://scanner.tradingview.com/indonesia/scan`
- Method: POST JSON
- Data: OHLCV + teknikal (RSI, MACD, EMA20, EMA50)
- Rate limit: Unlimited (unofficial endpoint)
- Status: Stable, tidak ada 403 Cloudflare

**Bisnis.com RSS:**

- Endpoint: `https://bisnis.com/feed/rss.xml`
- Method: GET RSS feed (XML parser built-in)
- Data: News articles dengan title, link, published date, summary
- Symbol extraction: Regex pattern `\b[A-Z]{4}\b` (BBCA, TLKM, ASII, etc)
- Rate limit: Unlimited (RSS feed gratis)
- Status: Stable, tidak perlu API key / registration
- Stored as: event_type=OFFICIAL_NEWS, source=BISNIS_COM di tabel `market_event_official`

**Validasi Cepat:**

1. Cek tabel terbentuk:

   ```sql
   SELECT COUNT(*) FROM market_technical_snapshot;
   SELECT COUNT(*) FROM market_price_history;
   SELECT COUNT(*) FROM market_event_official WHERE source='BISNIS_COM';
   SELECT source, status, message, created_at FROM sync_run_log ORDER BY created_at DESC LIMIT 10;
   ```

2. Cek API endpoint NestJS:

   ```bash
   curl "http://localhost:3000/market/technical?symbol=BBCA&limit=5"
   curl "http://localhost:3000/market/events?type=NEWS&symbol=BBCA"
   ```

   → Return technical snapshots + news items untuk BBCA

3. Cek RSS parsing (manual test):
   ```bash
   python3 -c "from python_sync.sources.bisnis_source import fetch_bisnis_news; news = fetch_bisnis_news(); print(f'Found {len(news)} news items'); print(news[0] if news else 'No news')"
   ```
