# Python Sync Service (TradingView + Bisnis.com RSS)

## Tujuan

- Ambil data teknikal (OHLCV, RSI, MACD, EMA, volume) dari endpoint TradingView scanner.
- Ambil data candle harian historis multi-tahun (default 10 tahun) dari TradingView chart API.
- Ambil news & artikel dari RSS feed Bisnis.com (gratis unlimited).
- Scan semua saham IDX atau symbols pilihan.
- Simpan ke DB PostgreSQL sendiri (tabel `market_technical_snapshot`, `market_price_history`, `market_event_official`).
- Jalankan sinkronisasi berkala tanpa scraping HTML frontend.

Arsitektur Ringkas

1. **TradingView Scanner source**
   - POST ke `https://scanner.tradingview.com/indonesia/scan`
   - Ambil snapshot teknikal semua saham IDX (kolom: close, volume, RSI, MACD, EMA20, EMA50)
   - Upsert ke: `market_technical_snapshot`

2. **TradingView Chart source** (PRIMARY ONLY)
   - Fetch OHLCV historis daily multi-tahun dari https://charts-node.tradingview.com
   - Indonesia stocks format: IDX:{symbol} (e.g., IDX:BBCA)
   - Stable, tidak rate-limited, official TradingView chart data
   - Primary dan SATU-SATUNYA source untuk chart history (no Yahoo fallback)
   - Jika fetch gagal: batch di-skip (tidak crash, lanjut batch berikutnya)
   - Upsert ke: `market_price_history` (source=TRADINGVIEW)

3. **Yahoo Finance History source** (DEPRECATED - removed)
   - Endpoint lama: https://query1.finance.yahoo.com (sering 429, tidak reliable)
   - **Status**: Dihapus sepenuhnya, sudah tidak digunakan
   - Alasan: Rate-limit masalah, TradingView lebih stabil

4. **Bisnis.com RSS source**
   - Fetch RSS dari `https://bisnis.com/feed/rss.xml`
   - Extract symbols dari title/description (pattern: BBCA, TLKM, ASII, dll)
   - Normalize ke format: source=BISNIS_COM, event_type=OFFICIAL_NEWS
   - Upsert ke: `market_event_official`

5. **Storage**
   - `market_technical_snapshot`: teknikal snapshots
   - `market_price_history`: candle history harian
   - `market_event_official`: news & events
   - `sync_run_log`: sync status log per source

6. **Scheduler**
   - Mode sekali jalan (`python sync_market_data.py --full-sync`)
   - Mode interval menit (`python sync_market_data.py --interval-min 15`)
   - Opsional cron/systemd di server

Struktur File

- `sync_market_data.py`: Entrypoint CLI + scheduler loop (TradingView chart + bisnis.com)
- `sources/tradingview_chart_source.py`: TradingView chart API fetcher untuk candle history (PRIMARY)
- `sources/tradingview_source.py`: TradingView scanner request + normalisasi teknikal
- `sources/bisnis_source.py`: Bisnis.com RSS parser + normalisasi news
- `config.py`: Environment config (DATABASE_URL, endpoint URLs, timeout, interval)
- `db.py`: DDL + upsert operations + sync logging
- `requirements.txt`: Python dependencies (requests, psycopg, python-dotenv)
- `sources/yahoo_history_source.py`: (DEPRECATED - no longer used)

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

**TradingView Chart API (Primary Data Source):**

- Endpoint: `https://charts-node.tradingview.com/chart.t`
- Indonesia symbol format: `IDX:BBCA`, `IDX:TLKM`, `IDX:ASII`, dll
- Method: GET dengan params (symbol, resolution=D, from, to)
- Data: OHLCV historical bars, multi-tahun (10-30 tahun)
- Rate limit: **NONE** (stable, resmi, tidak rate-limited)
- Status: **PRIMARY ONLY** (no Yahoo fallback anymore)
- Error handling: Per-symbol graceful (failed symbol logged, continue next)
- Batch error handling: Failed batch skipped, sync continues (no crash)

**Bisnis.com RSS:**

- Endpoint: `https://bisnis.com/feed/rss.xml`
- Method: GET RSS feed (XML parser built-in)
- Data: News articles dengan title, link, published date, summary
- Symbol extraction: Regex pattern `\b[A-Z]{4}\b` (BBCA, TLKM, ASII, etc)
- Rate limit: Unlimited (RSS feed gratis)
- Status: Stable, tidak perlu API key / registration
- Stored as: event_type=OFFICIAL_NEWS, source=BISNIS_COM di tabel `market_event_official`

**Strategi Data Source untuk Chart History:**

1. **TradingView Chart API (PRIMARY - ONLY)**
   - Endpoint: `https://charts-node.tradingview.com/chart.t`
   - Indonesia symbol format: `IDX:BBCA`, `IDX:TLKM`, dll
   - Method: GET dengan params (symbol, resolution=D, from, to timestamps)
   - Data: OHLCV historical bars, multi-tahun support (10-30 tahun available)
   - Rate limit: None (resmi, stable, tidak rate-limited)
   - **Status CURRENT**: PRIMARY source SAJA, tanpa fallback ke Yahoo
   - Error handling: Per-batch graceful (failed batch di-skip, lanjut batch berikutnya, tidak crash)
   - Fallback jika empty: Chart endpoint akan serve snapshot teknikal (intraday last 30 bars)

2. **Jika TradingView API return 0 candles:**
   - Kemungkinan penyebab:
     - Format symbol tidak sesuai (harus `IDX:SYMBOL` untuk Indonesia stocks)
     - API endpoint berubah atau rate-limited dari IP server (unlikely)
     - Data gap untuk symbol tertentu (delisting, new IPO, etc)
   - Solution:
     - Cek logs untuk symbol mana yang return 0
     - Verify symbol di https://www.tradingview.com/markets/stocks-indonesia/
     - Retry dengan `--history-batch-size 25` (lebih lambat, load lebih ringan)
     - Gunakan `--skip-history` untuk hanya ambil snapshot (no backfill)

3. **Chart endpoint behavior (src/app.service.ts):**
   - Tier 1: Coba db query `market_price_history` WHERE source='TRADINGVIEW' (primary)
   - Tier 2: Jika kosong, fallback ke recent snapshot teknikal (last 30 bars intraday)
   - Result: Chart endpoint **selalu** return data (no "no data" error), minimal snapshot

**Catatan PENTING:**

- Yahoo Finance source sudah **DIHAPUS sepenuhnya**.
- Data history sekarang HANYA dari TradingView (reliable, no rate-limit).
- Jika TradingView fetch gagal untuk symbol tertentu → batch di-skip → chart endpoint fallback ke snapshot.
- **Tidak ada lagi 429 error dari Yahoo Finance!**

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
