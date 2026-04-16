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

Jalankan Sinkron Sekali
python python_sync/sync_market_data.py --source all --symbols BBCA,TLKM,ASII

Jalankan Berkala per 30 menit
python python_sync/sync_market_data.py --source all --symbols BBCA,TLKM,ASII --interval-min 30

Contoh Cron (setiap 15 menit)
_/15 _ \* \* \* cd /Users/user/js_development/StockPilotService && /usr/bin/python3 python_sync/sync_market_data.py --source all --symbols BBCA,TLKM,ASII >> /tmp/market_sync.log 2>&1

Catatan Endpoint

- TradingView scanner endpoint diprioritaskan karena berbasis request JSON/XHR, bukan parse HTML chart.
- Endpoint IDX default bisa berubah sewaktu-waktu; jika berubah, update env URL tanpa ubah kode utama.

Validasi Cepat

- Cek tabel terbentuk: market_technical_snapshot, market_event_official, sync_run_log.
- Cek jumlah row bertambah setelah sync.
- Cek sync_run_log untuk status SUCCESS/FAILED.
