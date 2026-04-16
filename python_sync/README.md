Python Sync Service (TradingView + IDX)

Tujuan

- Ambil data market/technical dari endpoint network TradingView.
- Ambil data fundamental/corporate action/news resmi dari endpoint IDX/BEI.
- Simpan ke DB PostgreSQL sendiri.
- Jalankan sinkronisasi berkala tanpa scraping HTML frontend.

Arsitektur Ringkas

1. Source connectors
   - TradingView connector: POST ke endpoint scanner (JSON body).
   - IDX connector: GET endpoint resmi JSON (corporate action + news).
2. Normalizer
   - Map payload mentah ke format internal.
3. Storage
   - Upsert ke tabel:
     - market_technical_snapshot
     - market_event_official
     - sync_run_log
4. Scheduler
   - Mode sekali jalan untuk batch/manual.
   - Mode interval menit untuk service daemon.
   - Opsional pakai cron/systemd di server.

Struktur File

- sync_market_data.py: entrypoint CLI + scheduler loop.
- config.py: env config.
- db.py: DDL + upsert + log sync.
- sources/tradingview_source.py: request endpoint TradingView.
- sources/idx_source.py: request endpoint IDX + normalisasi.
- requirements.txt: dependency Python.

Persiapan

1. Install dependency
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r python_sync/requirements.txt

2. Pastikan env tersedia
   - DATABASE_URL wajib (pakai yang sama dengan NestJS jika ingin 1 DB).
   - Optional:
     - TRADINGVIEW_SCANNER_URL
     - IDX_CORPORATE_ACTION_URL
     - IDX_NEWS_URL
     - SYNC_REQUEST_TIMEOUT_SEC
     - SYNC_INTERVAL_MIN
       - IDX_FULL_SYNC_MAX_PAGES (default: 200)
       - IDX_PAGE_SIZE (default: 100)
       - TRADINGVIEW_ALL_PAGE_SIZE (default: 500)
       - TRADINGVIEW_ALL_MAX_ROWS (default: 3000)

Jalankan Sinkron Sekali
python python_sync/sync_market_data.py --source all --symbols BBCA,TLKM,ASII

Jalankan Sinkron Sekali (Semua Saham IDX, tanpa ketik symbols)
python python_sync/sync_market_data.py --source all

Jalankan Full Sync Pertama Kali (Backfill IDX)
python python_sync/sync_market_data.py --source all --symbols BBCA,TLKM,ASII --full-sync

Jalankan Full Sync Pertama Kali + Semua Saham IDX
python python_sync/sync_market_data.py --source all --full-sync

Catatan:

- `--full-sync` efektif untuk IDX (corporate action/news) dengan mode paging endpoint.
- Jika `--symbols` dikosongkan, TradingView auto-scan semua saham IDX (snapshot teknikal terbaru).
- TradingView scanner tetap memberi snapshot teknikal terbaru, bukan histori candle panjang.

Jalankan Berkala per 30 menit
python python_sync/sync_market_data.py --source all --symbols BBCA,TLKM,ASII --interval-min 30

Contoh Cron (setiap 15 menit)
*/15 * * * * cd /Users/user/js_development/StockPilotService && /usr/bin/python3 python_sync/sync_market_data.py --source all >> /tmp/market_sync.log 2>&1

Contoh Cron Office Hour (Senin-Jumat, 09:00-17:59, tiap 15 menit)
*/15 9-17 * * 1-5 cd /Users/user/js_development/StockPilotService && /usr/bin/python3 python_sync/sync_market_data.py --source all >> /tmp/market_sync.log 2>&1

Contoh Cron Jam Market IDX (perkiraan 09:00-16:15, Senin-Jumat)
*/15 9-15 * * 1-5 cd /Users/user/js_development/StockPilotService && /usr/bin/python3 python_sync/sync_market_data.py --source all >> /tmp/market_sync.log 2>&1
0,15 16 * * 1-5 cd /Users/user/js_development/StockPilotService && /usr/bin/python3 python_sync/sync_market_data.py --source all >> /tmp/market_sync.log 2>&1

Catatan Endpoint

- TradingView scanner endpoint diprioritaskan karena berbasis request JSON/XHR, bukan parse HTML chart.
- Endpoint IDX default bisa berubah sewaktu-waktu; jika berubah, update env URL tanpa ubah kode utama.

Validasi Cepat

- Cek tabel terbentuk: market_technical_snapshot, market_event_official, sync_run_log.
- Cek jumlah row bertambah setelah sync.
- Cek sync_run_log untuk status SUCCESS/FAILED.
