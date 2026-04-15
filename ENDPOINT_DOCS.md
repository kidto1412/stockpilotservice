# StockPilot IDX Analyzer - API Endpoints Documentation

**Base URL:** `http://localhost:3000/stockpilot`  
**Version:** 1.1.0

---

## 1. GET / (Root Info)

Menampilkan informasi aplikasi dan daftar endpoint yang tersedia.

### Request
```
GET /stockpilot/
```

### Response (200 OK)
```json
{
  "appName": "StockPilot IDX Analyzer",
  "version": "1.1.0",
  "description": "API rekomendasi saham Indonesia berbasis indikator teknikal, liquidity sweep, dan bid-offer.",
  "endpoints": {
    "recommendation": "POST /stock-analysis/recommendation",
    "recommendationAuto": "POST /stock-analysis/recommendation/auto",
    "marketData": "GET /stock-analysis/market-data/:symbol",
    "stream": "GET /stock-analysis/stream/:symbol",
    "tradingView": "GET /stock-analysis/tradingview/:symbol",
    "trainMl": "POST /stock-analysis/ml/train"
  },
  "ml": {
    "enabled": true,
    "note": "Model logistic regression sederhana untuk kalibrasi probabilitas BUY/SELL.",
    "training": {
      "trainedSamples": 0,
      "epochs": 0,
      "learningRate": 0,
      "lastTrainedAt": null
    }
  }
}
```

---

## 2. GET /stock-analysis/market-data/:symbol

Ambil data pasar terbaru dari Yahoo Finance untuk saham IDX. Menghitung indikator teknikal otomatis (RSI, MACD, EMA20, EMA50, Volume Ratio).

### Request

**Path Parameter:**
- `symbol` (string, required): Ticker saham IDX, contoh `BBCA`, `TLKM`, `ASII` (dengan atau tanpa suffix `.JK`)

**Query Parameter:**
- Tidak ada

### Example
```
GET /stockpilot/stock-analysis/market-data/BBCA
```

### Response (200 OK)
```json
{
  "symbol": "BBCA.JK",
  "closePrice": 5750.5,
  "indicators": {
    "rsi": 62.45,
    "macdHistogram": 125.30,
    "volumeRatio": 1.32,
    "ema20": 5625.00,
    "ema50": 5480.75
  },
  "source": {
    "provider": "Yahoo Finance",
    "range": "6mo",
    "interval": "1d"
  }
}
```

### Error Response (400 Bad Request)
```json
{
  "statusCode": 400,
  "message": "Gagal ambil data pasar untuk BBCA.JK. Status: 404",
  "error": "Bad Request"
}
```

---

## 3. POST /stock-analysis/recommendation

Analisis manual dengan mengirimkan indikator dan data pasar sendiri (tidak otomatis ambil dari Yahoo).

### Request Body
```json
{
  "symbol": "BBCA",
  "closePrice": 5750.5,
  "rsi": 62.45,
  "macdHistogram": 125.30,
  "volumeRatio": 1.32,
  "liquiditySweep": "BULLISH",
  "bidOfferImbalance": 0.25,
  "ema20": 5625.00,
  "ema50": 5480.75,
  "foreignFlowBillion": 15.5,
  "brokerNetBuyTop3Billion": 8.3,
  "tradingViewIndicators": ["RSI", "MACD", "VWAP"]
}
```

**Field Descriptions:**

| Field | Type | Required | Range/Enum | Description |
|-------|------|----------|-----------|-------------|
| symbol | string | Yes | - | Ticker saham (BBCA, TLKM, etc) |
| closePrice | number | Yes | >= 1 | Harga penutupan terakhir |
| rsi | number | Yes | 0-100 | Relative Strength Index (0-100) |
| macdHistogram | number | Yes | Any | Selisih MACD line vs Signal Line |
| volumeRatio | number | Yes | >= 0 | Volume hari ini / rata-rata 20 hari |
| liquiditySweep | enum | Yes | BULLISH, BEARISH, NONE | Signal liquidity sweep |
| bidOfferImbalance | number | Yes | -1 to 1 | Bid-Offer imbalance ratio |
| ema20 | number | Yes | - | EMA 20-hari |
| ema50 | number | Yes | - | EMA 50-hari |
| foreignFlowBillion | number | Yes | - | Foreign flow dalam miliar (bisa negatif) |
| brokerNetBuyTop3Billion | number | Yes | - | Net buy top 3 broker dalam miliar |
| tradingViewIndicators | array | No | Max 20 items | List indikator TradingView |

### Response (200 OK)
```json
{
  "symbol": "BBCA",
  "generatedAt": "2026-04-15T10:30:45.123Z",
  "methodology": ["TECHNICAL_INDICATORS", "LIQUIDITY_SWEEP", "BID_OFFER"],
  "marketBias": "BULLISH",
  "scoring": {
    "longScore": 14,
    "shortScore": 3,
    "confidence": "HIGH",
    "mlProbabilityBuy": 0.72,
    "mlSignal": "BUY",
    "mlNote": "Probabilitas BUY dari model logistic regression yang bisa dilatih ulang memakai data historis Anda."
  },
  "brokerSummary": {
    "foreignFlowBillion": 15.5,
    "top3BrokerNetBuyBillion": 8.3,
    "interpretation": "Afirmasi akumulasi dari asing dan broker utama."
  },
  "strategies": {
    "dayTrading": {
      "style": "DAY_TRADING",
      "recommendation": "BUY",
      "entry": 5763.76,
      "takeProfit": 5867.92,
      "trailingStop": 5754.13,
      "stopLoss": 5710.94,
      "cutLoss": 5710.94,
      "note": "Entry saat pullback valid di atas area demand intraday."
    },
    "swingTrading": {
      "style": "SWING_TRADING",
      "recommendation": "BUY",
      "entry": 5778.00,
      "takeProfit": 6125.38,
      "trailingStop": 5850.38,
      "stopLoss": 5603.00,
      "cutLoss": 5603.00,
      "note": "Entry saat pullback valid di atas area demand intraday."
    },
    "scalping": {
      "style": "SCALPING",
      "recommendation": "BUY",
      "entry": 5759.38,
      "takeProfit": 5811.19,
      "trailingStop": 5744.00,
      "stopLoss": 5724.19,
      "cutLoss": 5724.19,
      "note": "Entry saat pullback valid di atas area demand intraday."
    }
  },
  "tradingView": {
    "symbol": "IDX:BBCA",
    "defaultInterval": "60",
    "exchange": "IDX",
    "indicators": ["RSI", "MACD", "VWAP"],
    "chartUrl": "https://www.tradingview.com/chart/?symbol=IDX%3ABBCA"
  },
  "disclaimer": "Rekomendasi ini bersifat edukatif, bukan nasihat keuangan. Tetap lakukan analisis mandiri."
}
```

---

## 4. POST /stock-analysis/recommendation/auto

Analisis otomatis yang mengambil data pasar terbaru dari Yahoo Finance, lalu generate rekomendasi (hybrid: teknikal + ML).

### Request Body
```json
{
  "symbol": "BBCA",
  "liquiditySweep": "BULLISH",
  "bidOfferImbalance": 0.25,
  "foreignFlowBillion": 15.5,
  "brokerNetBuyTop3Billion": 8.3,
  "tradingViewIndicators": ["RSI", "MACD", "VWAP", "EMA"]
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| symbol | string | Yes | Ticker saham (BBCA, TLKM, ASII, etc) |
| liquiditySweep | enum | Yes | BULLISH \| BEARISH \| NONE |
| bidOfferImbalance | number | Yes | Range -1 to 1 |
| foreignFlowBillion | number | Yes | Foreign flow dalam miliar |
| brokerNetBuyTop3Billion | number | Yes | Net buy top 3 broker dalam miliar |
| tradingViewIndicators | array | No | List indikator untuk TradingView |

### Response (200 OK)
```json
{
  "marketData": {
    "symbol": "BBCA.JK",
    "closePrice": 5750.5,
    "indicators": {
      "rsi": 62.45,
      "macdHistogram": 125.30,
      "volumeRatio": 1.32,
      "ema20": 5625.00,
      "ema50": 5480.75
    },
    "source": {
      "provider": "Yahoo Finance",
      "range": "6mo",
      "interval": "1d"
    }
  },
  "recommendation": {
    "symbol": "BBCA.JK",
    "generatedAt": "2026-04-15T10:30:45.123Z",
    "methodology": ["TECHNICAL_INDICATORS", "LIQUIDITY_SWEEP", "BID_OFFER"],
    "marketBias": "BULLISH",
    "scoring": {
      "longScore": 14,
      "shortScore": 3,
      "confidence": "HIGH",
      "mlProbabilityBuy": 0.72,
      "mlSignal": "BUY",
      "mlNote": "Probabilitas BUY dari model logistic regression yang bisa dilatih ulang memakai data historis Anda."
    },
    "brokerSummary": {
      "foreignFlowBillion": 15.5,
      "top3BrokerNetBuyBillion": 8.3,
      "interpretation": "Afirmasi akumulasi dari asing dan broker utama."
    },
    "strategies": {
      "dayTrading": { /* same structure as endpoint #3 */ },
      "swingTrading": { /* same structure as endpoint #3 */ },
      "scalping": { /* same structure as endpoint #3 */ }
    },
    "tradingView": {
      "symbol": "IDX:BBCA",
      "defaultInterval": "60",
      "exchange": "IDX",
      "indicators": ["RSI", "MACD", "VWAP", "EMA"],
      "chartUrl": "https://www.tradingview.com/chart/?symbol=IDX%3ABBCA"
    },
    "disclaimer": "Rekomendasi ini bersifat edukatif, bukan nasihat keuangan. Tetap lakukan analisis mandiri."
  }
}
```

---

## 5. GET /stock-analysis/tradingview/:symbol

Dapatkan konfigurasi TradingView untuk saham, termasuk daftar indikator teknikal.

### Request

**Path Parameter:**
- `symbol` (string, required): Ticker saham, contoh `BBCA`, `TLKM`

**Query Parameter:**
- `indicators` (string, optional): Comma-separated list, contoh `RSI,MACD,VWAP,EMA`

### Example
```
GET /stockpilot/stock-analysis/tradingview/BBCA?indicators=RSI,MACD,VWAP
```

### Response (200 OK)
```json
{
  "symbol": "IDX:BBCA",
  "defaultInterval": "60",
  "exchange": "IDX",
  "indicators": ["RSI", "MACD", "VWAP"],
  "chartUrl": "https://www.tradingview.com/chart/?symbol=IDX%3ABBCA"
}
```

### Response (tanpa query indicators)
```
GET /stockpilot/stock-analysis/tradingview/BBCA
```
```json
{
  "symbol": "IDX:BBCA",
  "defaultInterval": "60",
  "exchange": "IDX",
  "indicators": ["RSI", "MACD", "VWAP", "EMA 20", "EMA 50", "Volume"],
  "chartUrl": "https://www.tradingview.com/chart/?symbol=IDX%3ABBCA"
}
```

---

## 6. GET /stock-analysis/stream/:symbol

Stream realtime rekomendasi otomatis. Endpoint ini memakai SSE (Server-Sent Events), jadi frontend cukup membuka koneksi sekali lalu menerima update berkala tanpa spam quick scan.

### Request

**Path Parameter:**
- `symbol` (string, required): Ticker saham, contoh `BBCA`, `TLKM`

**Query Parameter:**
- `intervalMs` (number, optional): Interval update dalam milidetik, minimum 5000. Default 15000
- `foreignFlowBillion` (number, optional): Input flow asing untuk memperkuat broker summary
- `brokerNetBuyTop3Billion` (number, optional): Input net buy top 3 broker
- `indicators` (string, optional): Daftar indikator TradingView dipisah koma
- `style` (string, optional): `DAY_TRADING`, `SWING_TRADING`, atau `SCALPING`

### Example
```
GET /stockpilot/stock-analysis/stream/BBCA?intervalMs=10000&style=DAY_TRADING
```

### Event Payload
```json
{
  "type": "realtime-recommendation",
  "symbol": "BBCA.JK",
  "updatedAt": "2026-04-16T10:30:45.123Z",
  "marketData": {
    "symbol": "BBCA.JK",
    "closePrice": 5750.5,
    "livePrice": 5750.5,
    "isRealTime": true,
    "indicators": {
      "rsi": 62.45,
      "macdHistogram": 125.3,
      "volumeRatio": 1.32,
      "ema20": 5625,
      "ema50": 5480.75
    },
    "candles": {
      "open": 5700,
      "high": 5765,
      "low": 5688,
      "previousHigh": 5772,
      "previousLow": 5660
    },
    "source": {
      "provider": "Yahoo Finance",
      "range": "1d",
      "interval": "1m",
      "cached": false,
      "realTime": true,
      "note": "Analisis memakai data intraday 1 menit + live quote terbaru."
    }
  },
  "realtimeSignals": {
    "liquiditySweep": "BULLISH",
    "bidOfferImbalance": 0.48,
    "reason": "Likuiditas bawah tersapu lalu harga reclaim level sebelumnya."
  },
  "recommendation": {
    "marketBias": "BULLISH",
    "preferredStyle": "DAY_TRADING",
    "scoring": {
      "mlProbabilityBuy": 0.72,
      "mlSignal": "BUY"
    }
  }
}
```

---

## 7. POST /stock-analysis/ml/train

Training/retrain model logistic regression dengan data historis berlabel BUY/SELL.

### Request Body
```json
{
  "samples": [
    {
      "rsi": 62.45,
      "macdHistogram": 125.30,
      "volumeRatio": 1.32,
      "bidOfferImbalance": 0.25,
      "emaSpreadPercent": 2.35,
      "foreignFlowBillion": 15.5,
      "brokerNetBuyTop3Billion": 8.3,
      "target": "BUY"
    },
    {
      "rsi": 35.20,
      "macdHistogram": -85.50,
      "volumeRatio": 0.95,
      "bidOfferImbalance": -0.30,
      "emaSpreadPercent": -1.80,
      "foreignFlowBillion": -12.0,
      "brokerNetBuyTop3Billion": -5.2,
      "target": "SELL"
    }
  ],
  "learningRate": 0.08,
  "epochs": 250
}
```

**Field Descriptions:**

| Field | Type | Required | Min/Max | Description |
|-------|------|----------|---------|-------------|
| samples | array | Yes | 20-5000 items | Array sample training |
| samples[].rsi | number | Yes | 0-100 | RSI value |
| samples[].macdHistogram | number | Yes | Any | MACD histogram |
| samples[].volumeRatio | number | Yes | >= 0 | Volume ratio |
| samples[].bidOfferImbalance | number | Yes | -1 to 1 | Bid-offer balance |
| samples[].emaSpreadPercent | number | Yes | Any | (EMA20-EMA50)/Close * 100 |
| samples[].foreignFlowBillion | number | Yes | Any | Foreign flow |
| samples[].brokerNetBuyTop3Billion | number | Yes | Any | Top 3 broker net buy |
| samples[].target | enum | Yes | BUY \| SELL | Label hasil sebenarnya |
| learningRate | number | No | 0.0001-1 | Learning rate (default: 0.08) |
| epochs | number | No | 10-2000 | Iterasi training (default: 250) |

### Response (200 OK)
```json
{
  "status": "MODEL_UPDATED",
  "training": {
    "trainedSamples": 250,
    "epochs": 250,
    "learningRate": 0.08,
    "lastTrainedAt": "2026-04-15T10:45:30.500Z",
    "trainAccuracy": 87.2
  },
  "weights": {
    "rsi": 0.22,
    "macdHistogram": 1.45,
    "volumeRatio": 0.78,
    "bidOfferImbalance": 1.65,
    "emaSpreadPercent": 0.95,
    "foreignFlowBillion": 0.12,
    "brokerNetBuyTop3Billion": 0.18,
    "bias": -0.45
  }
}
```

---

## Error Response Examples

### 400 Bad Request - Invalid Enum
```json
{
  "statusCode": 400,
  "message": "liquiditySweep must be one of the following values: BULLISH, BEARISH, NONE",
  "error": "Bad Request"
}
```

### 400 Bad Request - Validation Failure
```json
{
  "statusCode": 400,
  "message": "symbol should not be empty",
  "error": "Bad Request"
}
```

### 400 Bad Request - Data Tidak Cukup
```json
{
  "statusCode": 400,
  "message": "Data historis TLKM.JK belum cukup untuk menghitung indikator.",
  "error": "Bad Request"
}
```

---

## Notes

- **Prefix Global:** Semua endpoint menggunakan prefix `/stockpilot` (set di `main.ts`)
- **Authentication:** Endpoint stock-analysis publik (tidak perlu token), diekslusikan dari auth middleware
- **Validation:** Semua input akan divalidasi menggunakan class-validator (DTOs)
- **CORS:** Perlu dicek di `app.module.ts` untuk konfigurasi CORS jika cross-origin
- **Response Format:** Semua response dibungkus dengan GlobalResponseInterceptor
- **Error Handling:** Error ditangani oleh GlobalHttpExceptionFilter

---

## Testing dengan cURL

### Test Market Data
```bash
curl -X GET http://localhost:3000/stockpilot/stock-analysis/market-data/BBCA
```

### Test Auto Recommendation
```bash
curl -X POST http://localhost:3000/stockpilot/stock-analysis/recommendation/auto \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "BBCA",
    "liquiditySweep": "BULLISH",
    "bidOfferImbalance": 0.25,
    "foreignFlowBillion": 15.5,
    "brokerNetBuyTop3Billion": 8.3,
    "tradingViewIndicators": ["RSI", "MACD"]
  }'
```

### Test ML Training
```bash
curl -X POST http://localhost:3000/stockpilot/stock-analysis/ml/train \
  -H "Content-Type: application/json" \
  -d '{
    "samples": [
      {
        "rsi": 62.45,
        "macdHistogram": 125.30,
        "volumeRatio": 1.32,
        "bidOfferImbalance": 0.25,
        "emaSpreadPercent": 2.35,
        "foreignFlowBillion": 15.5,
        "brokerNetBuyTop3Billion": 8.3,
        "target": "BUY"
      }
    ],
    "learningRate": 0.08,
    "epochs": 250
  }'
```

---

**Last Updated:** 2026-04-15
