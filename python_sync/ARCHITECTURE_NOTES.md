Saran Arsitektur Endpoint-First (Tanpa Scrape HTML)

Prinsip

- Jangan scrape DOM/frontend HTML jika endpoint data resmi tersedia.
- Prioritas: endpoint API/XHR/fetch yang dipakai aplikasi web.
- Simpan raw payload untuk audit + replay parsing.

Layer Arsitektur

1. Endpoint Discovery Layer
   - Gunakan DevTools Network tab.
   - Filter: fetch/XHR, cari response JSON.
   - Simpan metadata endpoint:
     - URL
     - method
     - query/body
     - required headers/cookies
     - rate limit (jika terlihat)

2. Data Collector Layer
   - TradingView:
     - endpoint scanner JSON untuk market/technical snapshot.
   - IDX/BEI:
     - endpoint resmi pengumuman korporasi dan berita.
   - Implement retry + timeout + logging error.

3. Normalization Layer
   - Mapping field lintas sumber ke schema internal.
   - Contoh field inti:
     - symbol
     - snapshot_at/event_date
     - technical metrics (rsi/macd/ema/volume)
     - title/url untuk event resmi
   - Simpan raw_payload JSONB.

4. Persistence Layer
   - Upsert idempotent (unique key per event/snapshot).
   - Tabel log sync untuk observability.

5. Scheduler Layer
   - Mode daemon interval (loop) atau cron.
   - Pisahkan jadwal per sumber jika beban tinggi.

6. Observability Layer
   - Log sukses/gagal per run.
   - Simpan message error.
   - Alert sederhana jika gagal berturut-turut.

Reverse Engineering Checklist (Praktis)

1. Buka halaman target di browser.
2. DevTools -> Network -> fetch/XHR.
3. Refresh halaman dan trigger aksi yang memunculkan data.
4. Klik request kandidat, salin:
   - Request URL
   - Method
   - Headers penting
   - Query params / payload JSON
5. Uji ulang via curl atau requests Python.
6. Jika response valid tanpa rendering HTML, endpoint siap dipakai collector.

Kebijakan Aman

- Hormati Terms of Service dan robots/policy platform.
- Jangan bypass autentikasi/proteksi ilegal.
- Terapkan throttle agar tidak membebani sumber data.
