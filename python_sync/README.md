# Python Sync Service (TradingView + Bisnis.com RSS)

## Tujuan

- Ambil data teknikal (OHLCV, RSI, MACD, EMA, volume) dari endpoint TradingView scanner.
- Ambil news & artikel dari RSS feed Bisnis.com (gratis unlimited).
- Scan semua saham IDX atau symbols pilihan.
- Simpan ke DB PostgreSQL sendiri (tabel `market_technical_snapshot`, `market_event_official`).
- Jalankan sinkronisasi berkala tanpa scraping HTML frontend.

Arsitektur Ringkas

1. **TradingView Scanner source**
   - POST ke `https://scanner.tradingview.com/indonesia/scan`
   - Ambil snapshot teknikal semua saham IDX (kolom: close, volume, RSI, MACD, EMA20, EMA50)
   - Upsert ke: `market_technical_snapshot`

2. **Bisnis.com RSS source**
   - Fetch RSS dari `https://bisnis.com/feed/rss.xml`
   - Extract symbols dari title/description (pattern: BBCA, TLKM, ASII, dll)
   - Normalize ke format: source=BISNIS_COM, event_type=NEWS
   - Upsert ke: `market_event_official`

3. **Storage**
   - `market_technical_snapshot`: teknikal snapshots
   - `market_event_official`: news & events
   - `sync_run_log`: sync status log per source

4. **Scheduler**
   - Mode sekali jalan (`python sync_market_data.py --full-sync`)
   - Mode interval menit (`python sync_market_data.py --interval-min 15`)
   - Opsional cron/systemd di server

Struktur File

- `sync_market_data.py`: Entrypoint CLI + scheduler loop (TradingView + Bisnis.com)
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

Jalankan Sinkron Sekali (tulisan symbols optional)

```bash
python python_sync/sync_market_data.py --symbols BBCA,TLKM,ASII
```

Jalankan Full Sync Pertama Kali (Semua saham IDX, auto-scan)

```bash
python python_sync/sync_market_data.py --full-sync
```

Jalankan Berkala (setiap 15 menit)

```bash
python python_sync/sync_market_data.py --interval-min 15
```

**Catatan:**

- Jika `--symbols` dikosongkan → auto-scan semua saham IDX
- `--full-sync` → scan semua saham: technical snapshot + latest news dari Bisnis.com

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
- Stored as: event_type=NEWS, source=BISNIS_COM di tabel `market_event_official`

**Validasi Cepat:**

1. Cek tabel terbentuk:

   ```sql
   SELECT COUNT(*) FROM market_technical_snapshot;
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
