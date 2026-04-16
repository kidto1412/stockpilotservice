# Python Sync Service (TradingView Scanner)

## Tujuan

- Ambil data teknikal (OHLCV, RSI, MACD, EMA, volume) dari endpoint TradingView scanner.
- Scan semua saham IDX atau symbols pilihan.
- Simpan ke DB PostgreSQL sendiri (tabel `market_technical_snapshot`).
- Jalankan sinkronisasi berkala tanpa scraping HTML frontend.

Arsitektur Ringkas

1. **Source**: TradingView scanner endpoint
   - POST ke `https://scanner.tradingview.com/indonesia/scan`
   - Ambil snapshot teknikal semua saham IDX (kolom: close, volume, RSI, MACD, EMA20, EMA50)
2. **Normalizer**
   - Map response TradingView ke format internal (source, symbol, snapshot_at, indicators, raw_payload)
3. **Storage**
   - Upsert ke tabel: `market_technical_snapshot`
   - Log sync ke: `sync_run_log`
4. **Scheduler**
   - Mode sekali jalan (`python sync_market_data.py --full-sync`)
   - Mode interval menit (`python sync_market_data.py --interval-min 15`)
   - Opsional cron/systemd di server

Struktur File

- `sync_market_data.py`: Entrypoint CLI + scheduler loop
- `config.py`: Environment config (DATABASE_URL, endpoint URL, timeout, interval)
- `db.py`: DDL + upsert operations + sync logging
- `sources/tradingview_source.py`: TradingView scanner request + normalisasi data teknikal
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
- `--full-sync` → scan semua, snapshot teknikal terbaru saja (bukan histori candle)

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

**Validasi Cepat:**

1. Cek tabel terbentuk:

   ```sql
   SELECT COUNT(*) FROM market_technical_snapshot;
   SELECT COUNT(*) FROM sync_run_log WHERE source='TRADINGVIEW';
   ```

2. Cek API endpoint NestJS:

   ```bash
   curl "http://localhost:3000/market/technical?symbol=BBCA&limit=10"
   ```

   → Return latest 10 snapshots BBCA dengan close price, volume, RSI, MACD, EMA

3. Cek sync log:
   ```sql
   SELECT source, status, message, created_at FROM sync_run_log ORDER BY created_at DESC LIMIT 5;
   ```
