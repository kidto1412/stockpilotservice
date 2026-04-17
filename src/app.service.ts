import { BadRequestException, Injectable, MessageEvent } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AutoRecommendationRequestDto,
  ChartIndicatorQueryDto,
  LiquiditySweepSignal,
  MarketDataListQueryDto,
  MlTargetSignal,
  StockAnalysisRequestDto,
  TrainMlModelRequestDto,
} from './app.dto';
import { Observable, from, map, switchMap, catchError, of, timer } from 'rxjs';
import { PrismaService } from './prisma/prisma.service';

type MarketBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

type StrategyStyle = 'DAY_TRADING' | 'SWING_TRADING' | 'SCALPING';

type MlFeatureWeights = {
  rsi: number;
  macdHistogram: number;
  volumeRatio: number;
  bidOfferImbalance: number;
  emaSpreadPercent: number;
  foreignFlowBillion: number;
  brokerNetBuyTop3Billion: number;
};

type DbMarketRow = {
  source: string;
  symbol: string;
  snapshot_at: Date;
  close_price: number | null;
  volume: bigint | number | null;
  rsi: number | null;
  macd: number | null;
  macd_signal: number | null;
  ema20: number | null;
  ema50: number | null;
  raw_payload: unknown;
  prev_close_price?: number | null;
  prev_volume?: bigint | number | null;
};

type DbPriceHistoryRow = {
  price_at: Date;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  close_price: number | null;
  volume: bigint | number | null;
};

type ChartRange =
  | '1d'
  | '5d'
  | '1mo'
  | '3mo'
  | '6mo'
  | '1y'
  | '2y'
  | '5y'
  | '10y';

type ChartInterval =
  | '1m'
  | '5m'
  | '15m'
  | '30m'
  | '60m'
  | '4h'
  | '1d'
  | '1w'
  | '1mo';

type CandlePoint = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

type HistoryDerivedMetrics = {
  closePrice: number;
  lastUpdatedAt: string;
  rsi: number | null;
  macdHistogram: number | null;
  ema20: number | null;
  ema50: number | null;
  volumeRatio: number | null;
  stochK: number | null;
  stochD: number | null;
  stochSignal: 'GOLDEN_CROSS' | 'DEAD_CROSS' | 'NONE';
};

type ChartFetchResult = {
  candles: CandlePoint[];
  effectiveInterval: ChartInterval;
  effectiveRange: ChartRange;
  source: 'INTRADAY_1M' | 'DAILY_1D' | 'SNAPSHOT_FALLBACK';
};

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly marketDataCache = new Map<
    string,
    { data: any; cachedAt: number }
  >();

  private readonly marketDataCacheTtlMs = 10 * 60 * 1000;

  private mlWeights: MlFeatureWeights = {
    rsi: 0.18,
    macdHistogram: 1.2,
    volumeRatio: 0.65,
    bidOfferImbalance: 1.4,
    emaSpreadPercent: 0.75,
    foreignFlowBillion: 0.08,
    brokerNetBuyTop3Billion: 0.12,
  };

  private mlBias = -0.35;
  private mlTrainingMeta = {
    trainedSamples: 0,
    epochs: 0,
    learningRate: 0,
    lastTrainedAt: null as string | null,
  };

  getInfo() {
    return {
      appName: 'StockPilot IDX Analyzer',
      version: '1.2.0',
      description:
        'API rekomendasi saham Indonesia berbasis indikator teknikal, liquidity sweep, dan bid-offer.',
      endpoints: {
        recommendation: 'POST /stock-analysis/recommendation',
        recommendationAuto: 'POST /stock-analysis/recommendation/auto',
        marketDataAll: 'GET /stock-analysis/market-data',
        marketDataBySymbol: 'GET /stock-analysis/market-data/:symbol',
        chart: 'GET /stock-analysis/chart/:symbol',
        stream: 'GET /stock-analysis/stream/:symbol',
        tradingView: 'GET /stock-analysis/tradingview/:symbol',
        trainMl: 'POST /stock-analysis/ml/train',
      },
      ml: {
        enabled: true,
        note: 'Model logistic regression sederhana untuk kalibrasi probabilitas BUY/SELL.',
        training: this.mlTrainingMeta,
      },
    };
  }

  async getMarketDataList(query: MarketDataListQueryDto) {
    const source = this.normalizeMarketSource(query.source);

    const rows = await this.prisma.$queryRaw<DbMarketRow[]>`
      WITH ranked AS (
        SELECT
          source,
          symbol,
          snapshot_at,
          close_price,
          volume,
          rsi,
          macd,
          macd_signal,
          ema20,
          ema50,
          raw_payload,
          ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY snapshot_at DESC) AS rn
        FROM market_technical_snapshot
        ${source ? Prisma.sql`WHERE source = ${source}` : Prisma.sql``}
      )
      SELECT
        source,
        symbol,
        snapshot_at,
        close_price,
        volume,
        rsi,
        macd,
        macd_signal,
        ema20,
        ema50,
        raw_payload
      FROM ranked
      WHERE rn = 1
      ORDER BY snapshot_at DESC
      LIMIT ${query.limit}
    `;

    return {
      source,
      count: rows.length,
      items: rows.map((row) => this.mapDbRowToMarketPayload(row, null)),
    };
  }

  private normalizeMarketSource(source?: string) {
    const normalized = (source ?? 'TRADINGVIEW').trim().toUpperCase();

    if (!normalized || normalized === 'ALL' || normalized === 'ANY' || normalized === '*') {
      return null;
    }

    return normalized;
  }

  async getMarketData(symbol: string) {
    const normalizedSymbol = symbol.toUpperCase().replace('.JK', '').trim();

    const rows = await this.prisma.$queryRaw<DbMarketRow[]>`
      WITH ranked AS (
        SELECT
          source,
          symbol,
          snapshot_at,
          close_price,
          volume,
          rsi,
          macd,
          macd_signal,
          ema20,
          ema50,
          raw_payload,
          ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY snapshot_at DESC) AS rn
        FROM market_technical_snapshot
        WHERE source = 'TRADINGVIEW'
          AND symbol = ${normalizedSymbol}
      )
      SELECT
        l.source,
        l.symbol,
        l.snapshot_at,
        l.close_price,
        l.volume,
        l.rsi,
        l.macd,
        l.macd_signal,
        l.ema20,
        l.ema50,
        l.raw_payload,
        p.close_price AS prev_close_price,
        p.volume AS prev_volume
      FROM ranked l
      LEFT JOIN ranked p ON p.rn = 2
      WHERE l.rn = 1
      LIMIT 1
    `;

    const latest = rows[0];
    if (!latest) {
      throw new BadRequestException(
        `Data ${normalizedSymbol}.JK belum ada di database snapshot`,
      );
    }

    const historyMetrics =
      await this.fetchHistoryDerivedMetrics(normalizedSymbol);

    return this.mapDbRowToMarketPayload(
      latest,
      rows[0].prev_volume ?? null,
      historyMetrics,
    );
  }

  private mapDbRowToMarketPayload(
    row: DbMarketRow,
    prevVolumeInput: bigint | number | null,
    historyMetrics?: HistoryDerivedMetrics | null,
  ) {
    const closePrice = row.close_price ?? 0;
    const prevVolume = prevVolumeInput;
    const currentVolume = row.volume;
    const fallbackVolumeRatio = this.computeDbVolumeRatio(
      currentVolume,
      prevVolume,
    );
    const macdHistogram =
      row.macd !== null && row.macd_signal !== null
        ? row.macd - row.macd_signal
        : null;

    const effectiveClosePrice = historyMetrics?.closePrice ?? closePrice;
    const effectiveLastUpdatedAt =
      historyMetrics?.lastUpdatedAt ?? row.snapshot_at.toISOString();
    const effectiveRsi = historyMetrics?.rsi ?? row.rsi;
    const effectiveMacdHistogram =
      historyMetrics?.macdHistogram ?? macdHistogram;
    const effectiveEma20 = historyMetrics?.ema20 ?? row.ema20;
    const effectiveEma50 = historyMetrics?.ema50 ?? row.ema50;
    const effectiveVolumeRatio =
      historyMetrics?.volumeRatio ?? fallbackVolumeRatio;
    const effectiveStochK = historyMetrics?.stochK ?? null;
    const effectiveStochD = historyMetrics?.stochD ?? null;
    const effectiveStochSignal = historyMetrics?.stochSignal ?? 'NONE';

    const payload = {
      symbol: `${row.symbol}.JK`,
      closePrice: this.round(effectiveClosePrice),
      livePrice: null,
      isRealTime: false,
      lastUpdatedAt: effectiveLastUpdatedAt,
      indicators: {
        rsi: this.roundNullableNumber(effectiveRsi),
        macdHistogram: this.roundNullableNumber(effectiveMacdHistogram),
        volumeRatio: this.roundNullableNumber(effectiveVolumeRatio),
        ema20: this.roundNullableNumber(effectiveEma20),
        ema50: this.roundNullableNumber(effectiveEma50),
        stochastic: {
          k: this.roundNullableNumber(effectiveStochK),
          d: this.roundNullableNumber(effectiveStochD),
          signal: effectiveStochSignal,
        },
      },
      candles: {
        open: this.round(effectiveClosePrice),
        high: this.round(effectiveClosePrice),
        low: this.round(effectiveClosePrice),
        previousHigh: this.round(effectiveClosePrice),
        previousLow: this.round(effectiveClosePrice),
      },
      source: {
        provider: 'DATABASE_SNAPSHOT',
        table: 'market_technical_snapshot',
        source: row.source,
        cached: false,
        realTime: false,
        note: historyMetrics
          ? 'Harga+indikator diambil dari history 1D, snapshot dipakai sebagai fallback.'
          : 'Data diambil dari snapshot DB hasil sinkronisasi TradingView.',
      },
    };

    const autoSignals = this.deriveRealtimeSignals(payload);
    const recommendationPayload: StockAnalysisRequestDto = {
      symbol: payload.symbol,
      closePrice: payload.closePrice,
      rsi: payload.indicators.rsi ?? 50,
      macdHistogram: payload.indicators.macdHistogram ?? 0,
      volumeRatio: payload.indicators.volumeRatio ?? 1,
      liquiditySweep: autoSignals.liquiditySweep,
      bidOfferImbalance: autoSignals.bidOfferImbalance,
      ema20: payload.indicators.ema20 ?? payload.closePrice,
      ema50: payload.indicators.ema50 ?? payload.closePrice,
      foreignFlowBillion: 0,
      brokerNetBuyTop3Billion: 0,
      stochK: payload.indicators.stochastic?.k ?? undefined,
      stochD: payload.indicators.stochastic?.d ?? undefined,
      stochSignal: payload.indicators.stochastic?.signal ?? 'NONE',
    };

    const recommendation = this.generateRecommendation(recommendationPayload);
    return {
      ...payload,
      recommendation,
      marketBias: recommendation.marketBias,
      strategies: recommendation.strategies,
      tradingView: recommendation.tradingView,
      scoring: recommendation.scoring,
    };
  }

  private async fetchHistoryDerivedMetrics(
    normalizedSymbol: string,
  ): Promise<HistoryDerivedMetrics | null> {
    const rows = await this.prisma.$queryRaw<DbPriceHistoryRow[]>`
      WITH latest AS (
        SELECT
          price_at,
          high_price,
          low_price,
          close_price,
          volume
        FROM market_price_history
        WHERE source = 'TRADINGVIEW'
          AND symbol = ${normalizedSymbol}
          AND timeframe = '1D'
          AND close_price IS NOT NULL
        ORDER BY price_at DESC
        LIMIT 260
      )
      SELECT
        price_at,
        NULL::double precision AS open_price,
        high_price,
        low_price,
        close_price,
        volume
      FROM latest
      ORDER BY price_at ASC
    `;

    if (rows.length < 20) {
      return null;
    }

    const closes = rows
      .map((row) => row.close_price)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    if (closes.length < 20) {
      return null;
    }

    const highs = rows.map((row, idx) => row.high_price ?? closes[idx] ?? 0);
    const lows = rows.map((row, idx) => row.low_price ?? closes[idx] ?? 0);

    const rsiSeries = this.buildRsiSeries(closes, 14);
    const macdSeries = this.buildMacdSeries(closes, 12, 26, 9);
    const ema20Series = this.buildEmaSeriesNullable(closes, 20);
    const ema50Series = this.buildEmaSeriesNullable(closes, 50);
    const stochSeries = this.buildStochasticSeries(
      highs,
      lows,
      closes,
      10,
      5,
      5,
    );

    const lastIdx = closes.length - 1;
    const prevIdx = closes.length - 2;

    const lastVolume = rows[lastIdx]?.volume;
    const prevVolume = rows[prevIdx]?.volume;

    const toNumber = (value: bigint | number | null | undefined) =>
      typeof value === 'bigint' ? Number(value) : (value ?? null);

    const lastVolNum = toNumber(lastVolume);
    const prevVolNum = toNumber(prevVolume);
    const volumeRatio =
      lastVolNum && prevVolNum && prevVolNum > 0
        ? lastVolNum / prevVolNum
        : null;

    const lastK = stochSeries.k[lastIdx];
    const lastD = stochSeries.d[lastIdx];
    const prevK = stochSeries.k[prevIdx];
    const prevD = stochSeries.d[prevIdx];

    let stochSignal: 'GOLDEN_CROSS' | 'DEAD_CROSS' | 'NONE' = 'NONE';
    if (prevK !== null && prevD !== null && lastK !== null && lastD !== null) {
      if (prevK <= prevD && lastK > lastD) stochSignal = 'GOLDEN_CROSS';
      if (prevK >= prevD && lastK < lastD) stochSignal = 'DEAD_CROSS';
    }

    return {
      closePrice: closes[lastIdx],
      lastUpdatedAt: rows[lastIdx].price_at.toISOString(),
      rsi: rsiSeries[lastIdx],
      macdHistogram: macdSeries.histogram[lastIdx],
      ema20: ema20Series[lastIdx],
      ema50: ema50Series[lastIdx],
      volumeRatio,
      stochK: stochSeries.k[lastIdx],
      stochD: stochSeries.d[lastIdx],
      stochSignal,
    };
  }

  private computeDbVolumeRatio(
    currentVolume: bigint | number | null,
    previousVolume: bigint | number | null,
  ) {
    if (currentVolume === null || previousVolume === null) {
      return null;
    }

    const current =
      typeof currentVolume === 'bigint' ? Number(currentVolume) : currentVolume;
    const previous =
      typeof previousVolume === 'bigint'
        ? Number(previousVolume)
        : previousVolume;

    if (!previous || previous <= 0) {
      return null;
    }

    return current / previous;
  }

  private roundNullableNumber(value: number | null | undefined) {
    if (value === null || value === undefined) {
      return null;
    }
    return this.round(value);
  }

  private buildDegradedMarketData(symbol: string, reason: string) {
    const seed = this.symbolSeed(symbol);
    const basePrice = 500 + (seed % 8500);
    const ema20 = basePrice * 0.998;
    const ema50 = basePrice * 0.995;

    const fallbackMarketData = {
      symbol,
      closePrice: this.round(basePrice),
      livePrice: null,
      isRealTime: false,
      lastUpdatedAt: new Date().toISOString(),
      indicators: {
        rsi: 50,
        macdHistogram: 0,
        volumeRatio: 1,
        ema20: this.round(ema20),
        ema50: this.round(ema50),
      },
      candles: {
        open: this.round(basePrice),
        high: this.round(basePrice * 1.003),
        low: this.round(basePrice * 0.997),
        previousHigh: this.round(basePrice * 1.01),
        previousLow: this.round(basePrice * 0.99),
      },
      source: {
        provider: 'DEGRADED_FALLBACK',
        range: 'N/A',
        interval: 'N/A',
        cached: false,
        realTime: false,
        degraded: true,
        note: `Provider realtime tidak tersedia: ${reason}. Data fallback dipakai agar endpoint tidak gagal.`,
      },
    };

    const recommendationPayload: StockAnalysisRequestDto = {
      symbol: fallbackMarketData.symbol,
      closePrice: fallbackMarketData.closePrice,
      rsi: fallbackMarketData.indicators.rsi,
      macdHistogram: fallbackMarketData.indicators.macdHistogram,
      volumeRatio: fallbackMarketData.indicators.volumeRatio,
      liquiditySweep: LiquiditySweepSignal.NONE,
      bidOfferImbalance: 0,
      ema20: fallbackMarketData.indicators.ema20,
      ema50: fallbackMarketData.indicators.ema50,
      foreignFlowBillion: 0,
      brokerNetBuyTop3Billion: 0,
    };
    const recommendation = this.generateRecommendation(recommendationPayload);

    return {
      ...fallbackMarketData,
      recommendation,
      marketBias: recommendation.marketBias,
      strategies: recommendation.strategies,
      tradingView: recommendation.tradingView,
      scoring: recommendation.scoring,
    };
  }

  private symbolSeed(symbol: string) {
    let hash = 0;
    for (let i = 0; i < symbol.length; i++) {
      hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  private async fetchYahooQuote(symbol: string) {
    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
    const response = await this.fetchYahooWithFallback(quoteUrl);
    const data = await response.json();
    return data?.quoteResponse?.result?.[0] ?? null;
  }

  private async fetchYahooChart(symbol: string) {
    const chartUrl =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      '?interval=1m&range=1d&includePrePost=true&events=div%2Csplits';

    const response = await this.fetchYahooWithFallback(chartUrl);
    const data = await response.json();
    const result = data?.chart?.result?.[0];

    if (!result?.indicators?.quote?.[0]) {
      throw new BadRequestException(
        `Data saham ${symbol} tidak tersedia dari provider saat ini.`,
      );
    }

    const closes = (result.indicators.quote[0].close || []).filter(
      (value: number | null) => typeof value === 'number',
    ) as number[];

    const opens = (result.indicators.quote[0].open || []).filter(
      (value: number | null) => typeof value === 'number',
    ) as number[];

    const highs = (result.indicators.quote[0].high || []).filter(
      (value: number | null) => typeof value === 'number',
    ) as number[];

    const lows = (result.indicators.quote[0].low || []).filter(
      (value: number | null) => typeof value === 'number',
    ) as number[];

    const volumes = (result.indicators.quote[0].volume || []).filter(
      (value: number | null) => typeof value === 'number',
    ) as number[];

    return {
      closes,
      opens,
      highs,
      lows,
      volumes,
      lastTimestamp:
        result?.meta?.regularMarketTime ??
        (Array.isArray(result?.timestamp)
          ? result.timestamp[result.timestamp.length - 1]
          : null),
    };
  }

  private async buildRealtimeRecommendation(
    symbol: string,
    options?: {
      tradingViewIndicators?: string[];
      foreignFlowBillion?: number;
      brokerNetBuyTop3Billion?: number;
      strategyStyle?: StrategyStyle;
    },
  ) {
    const marketData = await this.getMarketData(symbol);
    const autoSignals = this.deriveRealtimeSignals(marketData);

    const recommendationPayload: StockAnalysisRequestDto = {
      symbol: marketData.symbol,
      closePrice: marketData.closePrice,
      rsi: marketData.indicators.rsi,
      macdHistogram: marketData.indicators.macdHistogram,
      volumeRatio: marketData.indicators.volumeRatio,
      liquiditySweep: autoSignals.liquiditySweep,
      bidOfferImbalance: autoSignals.bidOfferImbalance,
      ema20: marketData.indicators.ema20,
      ema50: marketData.indicators.ema50,
      foreignFlowBillion: options?.foreignFlowBillion ?? 0,
      brokerNetBuyTop3Billion: options?.brokerNetBuyTop3Billion ?? 0,
      tradingViewIndicators: options?.tradingViewIndicators,
      stochK: marketData.indicators.stochastic?.k ?? undefined,
      stochD: marketData.indicators.stochastic?.d ?? undefined,
      stochSignal: marketData.indicators.stochastic?.signal ?? 'NONE',
    };

    const recommendation = this.generateRecommendation(recommendationPayload);

    return {
      type: 'realtime-recommendation',
      symbol: marketData.symbol,
      updatedAt: new Date().toISOString(),
      marketData,
      realtimeSignals: autoSignals,
      recommendation: {
        ...recommendation,
        preferredStyle:
          options?.strategyStyle ??
          this.pickPreferredStyle(recommendation.marketBias),
      },
    };
  }

  async getChartWithIndicators(symbol: string, query: ChartIndicatorQueryDto) {
    const normalized = this.normalizeIdxSymbol(symbol);
    const interval: ChartInterval = query.interval ?? '5m';
    const range: ChartRange = query.range ?? '5d';
    const limit = query.limit ?? 300;

    const stylePreset = this.getChartStylePreset(query.style);
    const stochKPeriod = query.stochKPeriod ?? stylePreset.stochKPeriod;
    const stochKSmooth = query.stochKSmooth ?? stylePreset.stochKSmooth;
    const stochDPeriod = query.stochDPeriod ?? stylePreset.stochDPeriod;

    const rsiPeriod = query.rsiPeriod ?? 14;
    const macdFast = query.macdFast ?? 12;
    const macdSlow = query.macdSlow ?? 26;
    const macdSignal = query.macdSignal ?? 9;

    if (macdFast >= macdSlow) {
      throw new BadRequestException('macdFast harus lebih kecil dari macdSlow');
    }

    const emaPeriods = this.parseEmaPeriods(query.emaPeriods);
    const chartResult = await this.fetchCandlesForChart(
      normalized,
      interval,
      range,
    );
    const candles = chartResult.candles;

    if (!candles.length) {
      throw new BadRequestException(`Data candle ${normalized} tidak tersedia`);
    }

    const sliced = candles.slice(-limit);
    const closes = sliced.map((item) => item.c);
    const highs = sliced.map((item) => item.h);
    const lows = sliced.map((item) => item.l);

    const rsiSeries = this.buildRsiSeries(closes, rsiPeriod);
    const macdSeries = this.buildMacdSeries(
      closes,
      macdFast,
      macdSlow,
      macdSignal,
    );
    const stochSeries = this.buildStochasticSeries(
      highs,
      lows,
      closes,
      stochKPeriod,
      stochKSmooth,
      stochDPeriod,
    );
    const supportResistance = this.buildSupportResistanceLevels(sliced);
    const supportLevels = supportResistance.supports;
    const resistanceLevels = supportResistance.resistances;
    const levels = [
      ...supportLevels.map((price) => ({
        type: 'support' as const,
        price,
      })),
      ...resistanceLevels.map((price) => ({
        type: 'resistance' as const,
        price,
      })),
    ];

    const zonePadding = Math.max(
      0.001,
      this.round((sliced[sliced.length - 1].c || 0) * 0.005),
    );
    const zones = {
      support: supportResistance.nearestSupport
        ? {
            center: supportResistance.nearestSupport,
            low: this.round(supportResistance.nearestSupport - zonePadding),
            high: this.round(supportResistance.nearestSupport + zonePadding),
          }
        : null,
      resistance: supportResistance.nearestResistance
        ? {
            center: supportResistance.nearestResistance,
            low: this.round(supportResistance.nearestResistance - zonePadding),
            high: this.round(supportResistance.nearestResistance + zonePadding),
          }
        : null,
    };

    const emaMap: Record<string, Array<number | null>> = {};
    for (const period of emaPeriods) {
      emaMap[String(period)] = this.buildEmaSeriesNullable(closes, period);
    }

    const lastIndex = sliced.length - 1;
    const selectedStyle = query.style ?? 'swing';
    const stochSignal = this.getStochasticCrossSignal(stochSeries, lastIndex);

    const marketProbe = {
      closePrice: sliced[lastIndex].c,
      indicators: {
        rsi: rsiSeries[lastIndex] ?? 50,
        macdHistogram: macdSeries.histogram[lastIndex] ?? 0,
        volumeRatio: this.computeChartVolumeRatio(sliced, lastIndex) ?? 1,
        ema20: emaMap['20']?.[lastIndex] ?? sliced[lastIndex].c,
        ema50: emaMap['50']?.[lastIndex] ?? sliced[lastIndex].c,
        stochastic: {
          k: stochSeries.k[lastIndex] ?? null,
          d: stochSeries.d[lastIndex] ?? null,
          signal: stochSignal,
        },
      },
      candles: {
        high: sliced[lastIndex].h,
        low: sliced[lastIndex].l,
        previousHigh:
          lastIndex > 0 ? sliced[lastIndex - 1].h : sliced[lastIndex].h,
        previousLow:
          lastIndex > 0 ? sliced[lastIndex - 1].l : sliced[lastIndex].l,
      },
    };

    const autoSignals = this.deriveRealtimeSignals(marketProbe);
    const chartRecommendationPayload: StockAnalysisRequestDto = {
      symbol: normalized,
      closePrice: marketProbe.closePrice,
      rsi: marketProbe.indicators.rsi,
      macdHistogram: marketProbe.indicators.macdHistogram,
      volumeRatio: marketProbe.indicators.volumeRatio,
      liquiditySweep: autoSignals.liquiditySweep,
      bidOfferImbalance: autoSignals.bidOfferImbalance,
      ema20: marketProbe.indicators.ema20,
      ema50: marketProbe.indicators.ema50,
      foreignFlowBillion: 0,
      brokerNetBuyTop3Billion: 0,
      stochK: marketProbe.indicators.stochastic.k ?? undefined,
      stochD: marketProbe.indicators.stochastic.d ?? undefined,
      stochSignal: marketProbe.indicators.stochastic.signal,
    };
    const chartRecommendation = this.generateRecommendation(
      chartRecommendationPayload,
    );
    const selectedStrategyKey = this.mapChartStyleToStrategyKey(selectedStyle);
    const selectedStrategy =
      chartRecommendation.strategies[selectedStrategyKey];

    return {
      symbol: normalized,
      timeframe: {
        interval: chartResult.effectiveInterval,
        range: chartResult.effectiveRange,
      },
      source: chartResult.source,
      indicatorConfig: {
        style: query.style ?? 'swing',
        rsiPeriod,
        macdFast,
        macdSlow,
        macdSignal,
        stochastic: {
          kPeriod: stochKPeriod,
          kSmooth: stochKSmooth,
          dPeriod: stochDPeriod,
        },
        emaPeriods,
      },
      candles: sliced,
      indicators: {
        rsi: sliced.map((c, i) => ({
          t: c.t,
          value: this.roundNullable(rsiSeries[i]),
        })),
        macd: sliced.map((c, i) => ({
          t: c.t,
          macd: this.roundNullable(macdSeries.macd[i]),
          signal: this.roundNullable(macdSeries.signal[i]),
          histogram: this.roundNullable(macdSeries.histogram[i]),
        })),
        stochastic: sliced.map((c, i) => ({
          t: c.t,
          k: this.roundNullable(stochSeries.k[i]),
          d: this.roundNullable(stochSeries.d[i]),
        })),
        ema: Object.fromEntries(
          Object.entries(emaMap).map(([period, series]) => [
            period,
            sliced.map((c, i) => ({
              t: c.t,
              value: this.roundNullable(series[i]),
            })),
          ]),
        ),
      },
      latest: {
        close: this.round(sliced[lastIndex].c),
        rsi: this.roundNullable(rsiSeries[lastIndex]),
        macd: this.roundNullable(macdSeries.macd[lastIndex]),
        macdSignal: this.roundNullable(macdSeries.signal[lastIndex]),
        macdHistogram: this.roundNullable(macdSeries.histogram[lastIndex]),
        stochK: this.roundNullable(stochSeries.k[lastIndex]),
        stochD: this.roundNullable(stochSeries.d[lastIndex]),
        ema: Object.fromEntries(
          Object.entries(emaMap).map(([period, series]) => [
            period,
            this.roundNullable(series[lastIndex]),
          ]),
        ),
      },
      supportResistance,
      supportLevels,
      resistanceLevels,
      levels,
      zones,
      recommendation: {
        selectedStyle,
        selectedStrategyKey,
        marketBias: chartRecommendation.marketBias,
        scoring: chartRecommendation.scoring,
        signal: selectedStrategy.recommendation,
        entry: selectedStrategy.entry,
        takeProfit: selectedStrategy.takeProfit,
        trailingStop: selectedStrategy.trailingStop,
        stopLoss: selectedStrategy.stopLoss,
        cutLoss: selectedStrategy.cutLoss,
        note: selectedStrategy.note,
        strategies: chartRecommendation.strategies,
      },
      comparison: {
        engine: 'SAME_ENGINE_AS_/stock-analysis/recommendation',
        note: 'Perbedaan hasil chart vs recommendation/auto biasanya karena input berbeda (foreign flow, broker flow, liquidity sweep, bid-offer).',
        chartPayloadAssumptions: {
          foreignFlowBillion: 0,
          brokerNetBuyTop3Billion: 0,
          liquiditySweep: autoSignals.liquiditySweep,
          bidOfferImbalance: autoSignals.bidOfferImbalance,
        },
      },
    };
  }

  private mapChartStyleToStrategyKey(style: 'daily' | 'swing' | 'scalping') {
    if (style === 'daily') return 'dayTrading' as const;
    if (style === 'scalping') return 'scalping' as const;
    return 'swingTrading' as const;
  }

  private computeChartVolumeRatio(candles: CandlePoint[], lastIndex: number) {
    if (lastIndex <= 0) return null;
    const prev = candles[lastIndex - 1]?.v ?? 0;
    const curr = candles[lastIndex]?.v ?? 0;
    if (prev <= 0) return null;
    return curr / prev;
  }

  private getStochasticCrossSignal(
    stochSeries: { k: Array<number | null>; d: Array<number | null> },
    idx: number,
  ): 'GOLDEN_CROSS' | 'DEAD_CROSS' | 'NONE' {
    if (idx <= 0) return 'NONE';
    const prevK = stochSeries.k[idx - 1];
    const prevD = stochSeries.d[idx - 1];
    const nowK = stochSeries.k[idx];
    const nowD = stochSeries.d[idx];

    if (prevK === null || prevD === null || nowK === null || nowD === null) {
      return 'NONE';
    }

    if (prevK <= prevD && nowK > nowD) return 'GOLDEN_CROSS';
    if (prevK >= prevD && nowK < nowD) return 'DEAD_CROSS';
    return 'NONE';
  }

  private deriveRealtimeSignals(marketData: any) {
    const closePrice = marketData.closePrice;
    const ema20 = marketData.indicators.ema20;
    const ema50 = marketData.indicators.ema50;
    const rsi = marketData.indicators.rsi;
    const volumeRatio = marketData.indicators.volumeRatio;
    const currentHigh = marketData.candles?.high ?? closePrice;
    const currentLow = marketData.candles?.low ?? closePrice;
    const previousHigh = marketData.candles?.previousHigh ?? closePrice;
    const previousLow = marketData.candles?.previousLow ?? closePrice;

    const bullishSweep =
      currentLow < previousLow &&
      closePrice > previousLow &&
      closePrice > ema20;
    const bearishSweep =
      currentHigh > previousHigh &&
      closePrice < previousHigh &&
      closePrice < ema20;

    const liquiditySweep: LiquiditySweepSignal = bullishSweep
      ? LiquiditySweepSignal.BULLISH
      : bearishSweep
        ? LiquiditySweepSignal.BEARISH
        : LiquiditySweepSignal.NONE;

    const trendBias =
      closePrice > ema20 && ema20 > ema50
        ? 1
        : closePrice < ema20 && ema20 < ema50
          ? -1
          : 0;
    const momentumBias = rsi > 60 ? 0.3 : rsi < 40 ? -0.3 : 0;
    const volumeBias = volumeRatio > 1.2 ? 0.2 : volumeRatio < 0.8 ? -0.2 : 0;
    const sweepBias =
      liquiditySweep === LiquiditySweepSignal.BULLISH
        ? 0.25
        : liquiditySweep === LiquiditySweepSignal.BEARISH
          ? -0.25
          : 0;

    const bidOfferImbalance = this.clamp(
      trendBias * 0.45 + momentumBias + volumeBias + sweepBias,
      -1,
      1,
    );

    return {
      liquiditySweep,
      bidOfferImbalance: this.round(bidOfferImbalance),
      reason:
        liquiditySweep === LiquiditySweepSignal.BULLISH
          ? 'Likuiditas bawah tersapu lalu harga reclaim level sebelumnya.'
          : liquiditySweep === LiquiditySweepSignal.BEARISH
            ? 'Likuiditas atas tersapu lalu harga gagal bertahan di atas level sebelumnya.'
            : 'Tidak ada sweep yang jelas dari candle intraday terakhir.',
    };
  }

  private pickPreferredStyle(bias: string): StrategyStyle {
    if (bias === 'BULLISH') return 'DAY_TRADING';
    if (bias === 'BEARISH') return 'SCALPING';
    return 'SWING_TRADING';
  }

  private async fetchYahooCandles(
    symbol: string,
    interval: ChartInterval,
    range: ChartRange,
  ) {
    const chartUrl =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&includePrePost=true&events=div%2Csplits`;

    const response = await this.fetchYahooWithFallback(chartUrl);
    const data = await response.json();
    const result = data?.chart?.result?.[0];

    if (!result?.indicators?.quote?.[0] || !Array.isArray(result?.timestamp)) {
      throw new BadRequestException(`Data chart ${symbol} tidak tersedia`);
    }

    const quote = result.indicators.quote[0];
    const timestamps = result.timestamp as number[];
    const opens = quote.open ?? [];
    const highs = quote.high ?? [];
    const lows = quote.low ?? [];
    const closes = quote.close ?? [];
    const volumes = quote.volume ?? [];

    const candles: CandlePoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (typeof c !== 'number') continue;

      const o = typeof opens[i] === 'number' ? opens[i] : c;
      const h = typeof highs[i] === 'number' ? highs[i] : c;
      const l = typeof lows[i] === 'number' ? lows[i] : c;
      const v = typeof volumes[i] === 'number' ? volumes[i] : 0;

      candles.push({
        t: new Date(timestamps[i] * 1000).toISOString(),
        o,
        h,
        l,
        c,
        v,
      });
    }

    return candles;
  }

  private async fetchCandlesForChart(
    symbol: string,
    interval: ChartInterval,
    range: ChartRange,
  ): Promise<ChartFetchResult> {
    const dbDailyCandles = await this.fetchDbDailyCandles(symbol, range);

    if (interval === '1w') {
      return {
        candles: this.aggregateCandlePoints(dbDailyCandles, '1w'),
        effectiveInterval: '1w',
        effectiveRange: range,
        source: 'DAILY_1D',
      };
    }

    if (interval === '1mo') {
      return {
        candles: this.aggregateCandlePoints(dbDailyCandles, '1mo'),
        effectiveInterval: '1mo',
        effectiveRange: range,
        source: 'DAILY_1D',
      };
    }

    if (interval === '1d') {
      return {
        candles: dbDailyCandles,
        effectiveInterval: '1d',
        effectiveRange: range,
        source: 'DAILY_1D',
      };
    }

    const intradayRange = this.clampRangeForIntraday(range);

    const dbIntradayCandles = await this.fetchDbIntradayCandles(
      symbol,
      interval,
      intradayRange,
    );

    const minIntradayCandles = this.getMinimumIntradayCandles(
      interval,
      intradayRange,
    );
    if (dbIntradayCandles.length >= minIntradayCandles) {
      return {
        candles: dbIntradayCandles,
        effectiveInterval: interval,
        effectiveRange: intradayRange,
        source: 'INTRADAY_1M',
      };
    }

    if (dbIntradayCandles.length > 0 && dbDailyCandles.length > 0) {
      // Intraday belum cukup untuk range yang diminta (umumnya karena histori 1M baru terkumpul sebagian).
      // Fallback ke daily agar chart tetap informatif dan tidak tampil hanya beberapa candle.
      return {
        candles: dbDailyCandles,
        effectiveInterval: '1d',
        effectiveRange: range,
        source: 'DAILY_1D',
      };
    }

    // Fallback aman: tetap layani chart dari daily history agar tidak error ke client.
    if (dbDailyCandles.length > 0) {
      return {
        candles: dbDailyCandles,
        effectiveInterval: '1d',
        effectiveRange: range,
        source: 'DAILY_1D',
      };
    }

    return {
      candles: await this.generateFallbackFromSnapshot(
        symbol.toUpperCase().replace('.JK', '').trim(),
      ),
      effectiveInterval: interval,
      effectiveRange: range,
      source: 'SNAPSHOT_FALLBACK',
    };
  }

  private clampRangeForIntraday(range: ChartRange): ChartRange {
    const days = this.getRangeDays(range);
    if (days <= 5) return '5d';
    if (days <= 31) return '1mo';
    // Intraday DB window currently optimized for up to ~30 hari.
    return '1mo';
  }

  private getMinimumIntradayCandles(
    interval: Exclude<ChartInterval, '1d' | '1w' | '1mo'>,
    range: ChartRange,
  ) {
    const intradayWindowDays = Math.min(this.getRangeDays(range), 30);
    const expected = {
      '1m': intradayWindowDays * 180,
      '5m': intradayWindowDays * 36,
      '15m': intradayWindowDays * 12,
      '30m': intradayWindowDays * 6,
      '60m': intradayWindowDays * 3,
      '4h': intradayWindowDays * 2,
    }[interval];

    // Threshold dinamis: cukup untuk chart usable, tapi tidak terlalu ketat.
    // Cap atas 180 agar simbol baru tetap bisa tampil intraday.
    return Math.max(20, Math.min(180, Math.floor(expected * 0.1)));
  }

  private async fetchDbDailyCandles(symbol: string, range: ChartRange) {
    const normalizedSymbol = symbol.toUpperCase().replace('.JK', '').trim();
    const fromDate = new Date(
      Date.now() - this.getRangeDays(range) * 24 * 60 * 60 * 1000,
    );

    // Priority 1: TradingView chart data (primary source)
    const tvCandles = await this.prisma.$queryRaw<DbPriceHistoryRow[]>`
      SELECT
        price_at,
        open_price,
        high_price,
        low_price,
        close_price,
        volume
      FROM market_price_history
      WHERE source = 'TRADINGVIEW'
        AND symbol = ${normalizedSymbol}
        AND timeframe = '1D'
        AND price_at >= ${fromDate}
      ORDER BY price_at ASC
    `;

    if (tvCandles.length > 0) {
      return tvCandles
        .filter((row) => row.close_price !== null)
        .map((row) => ({
          t: row.price_at.toISOString(),
          o: row.open_price ?? row.close_price ?? 0,
          h: row.high_price ?? row.close_price ?? 0,
          l: row.low_price ?? row.close_price ?? 0,
          c: row.close_price ?? 0,
          v:
            typeof row.volume === 'bigint'
              ? Number(row.volume)
              : (row.volume ?? 0),
        }));
    }

    // Priority 2: Yahoo fallback
    const yahooCandles = await this.prisma.$queryRaw<DbPriceHistoryRow[]>`
      SELECT
        price_at,
        open_price,
        high_price,
        low_price,
        close_price,
        volume
      FROM market_price_history
      WHERE source = 'YAHOO'
        AND symbol = ${normalizedSymbol}
        AND timeframe = '1D'
        AND price_at >= ${fromDate}
      ORDER BY price_at ASC
    `;

    if (yahooCandles.length > 0) {
      return yahooCandles
        .filter((row) => row.close_price !== null)
        .map((row) => ({
          t: row.price_at.toISOString(),
          o: row.open_price ?? row.close_price ?? 0,
          h: row.high_price ?? row.close_price ?? 0,
          l: row.low_price ?? row.close_price ?? 0,
          c: row.close_price ?? 0,
          v:
            typeof row.volume === 'bigint'
              ? Number(row.volume)
              : (row.volume ?? 0),
        }));
    }

    // Priority 3: TradingView snapshot fallback (last 30 recent snapshots)
    return this.generateFallbackFromSnapshot(normalizedSymbol);
  }

  private async generateFallbackFromSnapshot(symbol: string) {
    const rows = await this.prisma.$queryRaw<DbMarketRow[]>`
      SELECT
        snapshot_at,
        close_price,
        volume
      FROM market_technical_snapshot
      WHERE source = 'TRADINGVIEW'
        AND symbol = ${symbol}
      ORDER BY snapshot_at DESC
      LIMIT 30
    `;

    if (rows.length === 0) {
      return [];
    }

    return rows.reverse().map((row) => ({
      t: row.snapshot_at.toISOString(),
      o: row.close_price ?? 0,
      h: row.close_price ?? 0,
      l: row.close_price ?? 0,
      c: row.close_price ?? 0,
      v:
        typeof row.volume === 'bigint' ? Number(row.volume) : (row.volume ?? 0),
    }));
  }

  private async fetchDbIntradayCandles(
    symbol: string,
    interval: '1m' | '5m' | '15m' | '30m' | '60m' | '4h',
    range: ChartRange,
  ) {
    const normalizedSymbol = symbol.toUpperCase().replace('.JK', '').trim();

    // Priority 1: intraday 1-menit dari market_price_history (hasil sync TradingView).
    const lookbackDays = Math.min(this.getRangeDays(range), 30);
    const fromDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    const rawIntraday = await this.prisma.$queryRaw<DbPriceHistoryRow[]>`
      SELECT
        price_at,
        open_price,
        high_price,
        low_price,
        close_price,
        volume
      FROM market_price_history
      WHERE source = 'TRADINGVIEW'
        AND symbol = ${normalizedSymbol}
        AND timeframe = '1M'
        AND price_at >= ${fromDate}
      ORDER BY price_at ASC
    `;

    if (rawIntraday.length > 0) {
      const bucketMs = this.intervalToMs(interval);
      const buckets = new Map<
        number,
        { o: number; h: number; l: number; c: number; v: number }
      >();

      for (const row of rawIntraday) {
        const close = row.close_price ?? 0;
        if (close <= 0) continue;

        const ts = row.price_at.getTime();
        const bucketTs = Math.floor(ts / bucketMs) * bucketMs;
        const open = row.open_price ?? close;
        const high = row.high_price ?? close;
        const low = row.low_price ?? close;
        const volume =
          typeof row.volume === 'bigint'
            ? Number(row.volume)
            : (row.volume ?? 0);

        const existing = buckets.get(bucketTs);
        if (!existing) {
          buckets.set(bucketTs, {
            o: open,
            h: high,
            l: low,
            c: close,
            v: volume,
          });
          continue;
        }

        existing.h = Math.max(existing.h, high);
        existing.l = Math.min(existing.l, low);
        existing.c = close;
        existing.v += volume;
      }

      const result = Array.from(buckets.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([bucketTs, c]) => ({
          t: new Date(bucketTs).toISOString(),
          o: c.o,
          h: c.h,
          l: c.l,
          c: c.c,
          v: c.v,
        }));

      if (result.length > 0) {
        return result;
      }
    }

    // Priority 2: fallback snapshot DB; untuk range besar batasi supaya query tetap ringan.

    const rows = await this.prisma.$queryRaw<
      Array<{
        snapshot_at: Date;
        close_price: number | null;
        volume: bigint | number | null;
      }>
    >`
      SELECT
        snapshot_at,
        close_price,
        volume
      FROM market_technical_snapshot
      WHERE source = 'TRADINGVIEW'
        AND symbol = ${normalizedSymbol}
        AND snapshot_at >= ${fromDate}
      ORDER BY snapshot_at ASC
      LIMIT 20000
    `;

    if (!rows.length) {
      return [];
    }

    const bucketMs = this.intervalToMs(interval);
    const buckets = new Map<
      number,
      { o: number; h: number; l: number; c: number; v: number }
    >();

    for (const row of rows) {
      const close = row.close_price ?? 0;
      if (close <= 0) continue;

      const ts = row.snapshot_at.getTime();
      const bucketTs = Math.floor(ts / bucketMs) * bucketMs;
      const volume =
        typeof row.volume === 'bigint' ? Number(row.volume) : (row.volume ?? 0);

      const existing = buckets.get(bucketTs);
      if (!existing) {
        buckets.set(bucketTs, {
          o: close,
          h: close,
          l: close,
          c: close,
          v: volume,
        });
        continue;
      }

      existing.h = Math.max(existing.h, close);
      existing.l = Math.min(existing.l, close);
      existing.c = close;
      existing.v += volume;
    }

    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([bucketTs, c]) => ({
        t: new Date(bucketTs).toISOString(),
        o: c.o,
        h: c.h,
        l: c.l,
        c: c.c,
        v: c.v,
      }));
  }

  private intervalToMs(interval: '1m' | '5m' | '15m' | '30m' | '60m' | '4h') {
    if (interval === '1m') return 60_000;
    if (interval === '5m') return 5 * 60_000;
    if (interval === '15m') return 15 * 60_000;
    if (interval === '30m') return 30 * 60_000;
    if (interval === '4h') return 4 * 60 * 60_000;
    return 60 * 60_000; // 60m
  }

  private aggregateCandlePoints(
    candles: CandlePoint[],
    interval: '1w' | '1mo',
  ): CandlePoint[] {
    if (!candles.length) {
      return candles;
    }

    const buckets = new Map<
      number,
      { o: number; h: number; l: number; c: number; v: number }
    >();

    for (const candle of candles) {
      const ts = new Date(candle.t).getTime();
      if (!Number.isFinite(ts)) continue;

      const bucketTs = this.bucketStartTs(ts, interval);
      const existing = buckets.get(bucketTs);

      if (!existing) {
        buckets.set(bucketTs, {
          o: candle.o,
          h: candle.h,
          l: candle.l,
          c: candle.c,
          v: candle.v,
        });
        continue;
      }

      existing.h = Math.max(existing.h, candle.h);
      existing.l = Math.min(existing.l, candle.l);
      existing.c = candle.c;
      existing.v += candle.v;
    }

    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([bucketTs, c]) => ({
        t: new Date(bucketTs).toISOString(),
        o: c.o,
        h: c.h,
        l: c.l,
        c: c.c,
        v: c.v,
      }));
  }

  private bucketStartTs(ts: number, interval: '1w' | '1mo'): number {
    const d = new Date(ts);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const day = d.getUTCDate();

    if (interval === '1mo') {
      return Date.UTC(year, month, 1, 0, 0, 0, 0);
    }

    // ISO-like week start on Monday.
    const weekday = d.getUTCDay();
    const shift = (weekday + 6) % 7;
    return Date.UTC(year, month, day - shift, 0, 0, 0, 0);
  }

  private getRangeDays(range: ChartRange) {
    if (range === '1d') return 1;
    if (range === '5d') return 5;
    if (range === '1mo') return 31;
    if (range === '3mo') return 92;
    if (range === '6mo') return 183;
    if (range === '1y') return 366;
    if (range === '2y') return 732;
    if (range === '5y') return 1830;
    return 3660;
  }

  private getChartStylePreset(style?: 'daily' | 'swing' | 'scalping') {
    if (style === 'daily') {
      return { stochKPeriod: 14, stochKSmooth: 3, stochDPeriod: 3 };
    }
    if (style === 'scalping') {
      return { stochKPeriod: 5, stochKSmooth: 3, stochDPeriod: 3 };
    }
    return { stochKPeriod: 10, stochKSmooth: 5, stochDPeriod: 5 };
  }

  private parseEmaPeriods(raw?: string) {
    if (!raw?.trim()) return [20, 50];

    const parsed = raw
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((n) => Number.isInteger(n) && n >= 2 && n <= 400);

    const unique = [...new Set(parsed)].slice(0, 5);
    return unique.length ? unique : [20, 50];
  }

  private buildRsiSeries(values: number[], period: number) {
    const out: Array<number | null> = Array(values.length).fill(null);
    if (values.length <= period) return out;

    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i++) {
      const diff = values[i] - values[i - 1];
      if (diff >= 0) gain += diff;
      else loss += Math.abs(diff);
    }

    let avgGain = gain / period;
    let avgLoss = loss / period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (let i = period + 1; i < values.length; i++) {
      const diff = values[i] - values[i - 1];
      const currentGain = diff > 0 ? diff : 0;
      const currentLoss = diff < 0 ? Math.abs(diff) : 0;

      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }

    return out;
  }

  private buildMacdSeries(
    values: number[],
    fast: number,
    slow: number,
    signalPeriod: number,
  ) {
    const emaFast = this.buildEmaSeriesNullable(values, fast);
    const emaSlow = this.buildEmaSeriesNullable(values, slow);

    const macd = values.map((_, i) => {
      if (emaFast[i] === null || emaSlow[i] === null) return null;
      return (emaFast[i] as number) - (emaSlow[i] as number);
    });

    const macdValues = macd.map((v) => v ?? 0);
    const signal = this.buildEmaSeriesNullable(macdValues, signalPeriod).map(
      (v, i) => (macd[i] === null ? null : v),
    );

    const histogram = macd.map((m, i) => {
      if (m === null || signal[i] === null) return null;
      return m - (signal[i] as number);
    });

    return { macd, signal, histogram };
  }

  private buildStochasticSeries(
    highs: number[],
    lows: number[],
    closes: number[],
    kPeriod: number,
    kSmooth: number,
    dPeriod: number,
  ) {
    const rawK: Array<number | null> = Array(closes.length).fill(null);

    for (let i = kPeriod - 1; i < closes.length; i++) {
      const highWindow = highs.slice(i - kPeriod + 1, i + 1);
      const lowWindow = lows.slice(i - kPeriod + 1, i + 1);
      const highest = Math.max(...highWindow);
      const lowest = Math.min(...lowWindow);
      const range = highest - lowest;

      rawK[i] = range === 0 ? 50 : ((closes[i] - lowest) / range) * 100;
    }

    const k = this.simpleMovingAverage(rawK, kSmooth);
    const d = this.simpleMovingAverage(k, dPeriod);
    return { k, d };
  }

  private simpleMovingAverage(
    values: Array<number | null>,
    period: number,
  ): Array<number | null> {
    const out: Array<number | null> = Array(values.length).fill(null);
    for (let i = 0; i < values.length; i++) {
      const window = values
        .slice(i - period + 1, i + 1)
        .filter((v): v is number => v !== null);
      if (window.length === period) {
        out[i] = window.reduce((sum, item) => sum + item, 0) / period;
      }
    }
    return out;
  }

  private buildEmaSeriesNullable(
    values: number[],
    period: number,
  ): Array<number | null> {
    const out: Array<number | null> = Array(values.length).fill(null);
    if (!values.length) return out;

    const k = 2 / (period + 1);
    let ema = values[0];
    out[0] = ema;
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
      out[i] = ema;
    }
    return out;
  }

  private roundNullable(value: number | null) {
    if (value === null) return null;
    return this.round(value);
  }

  private async fetchYahooWithFallback(url: string) {
    const candidates = [
      url,
      url.replace('query1.finance.yahoo.com', 'query2.finance.yahoo.com'),
    ];

    let lastError: unknown = null;

    for (const candidate of candidates) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(candidate, {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'curl/7.68.0',
              Referer: 'https://finance.yahoo.com/',
              Origin: 'https://finance.yahoo.com',
              'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
              Connection: 'keep-alive',
            },
          });

          if (!response.ok) {
            if (response.status === 429) {
              lastError = new BadRequestException(
                'Provider rate limit tercapai. Gunakan cache yang sudah ada atau coba lagi beberapa saat.',
              );
              await this.delay(500 * (attempt + 1));
              continue;
            }

            lastError = new BadRequestException(
              `Gagal ambil data pasar. Status: ${response.status}`,
            );
            break;
          }

          return response;
        } catch (error) {
          lastError = error;
          await this.delay(500 * (attempt + 1));
        }
      }
    }

    throw lastError instanceof BadRequestException
      ? lastError
      : new BadRequestException(
          'Provider Yahoo Finance tidak merespons. Coba lagi beberapa saat.',
        );
  }

  private async delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getTradingViewConfig(symbol: string, indicators?: string[]) {
    const cleanSymbol = symbol.toUpperCase().replace('.JK', '').trim();
    const parsedIndicators =
      indicators && indicators.length
        ? indicators
        : ['RSI', 'MACD', 'VWAP', 'EMA 20', 'EMA 50', 'Volume'];

    return {
      symbol: `IDX:${cleanSymbol}`,
      defaultInterval: '60',
      exchange: 'IDX',
      indicators: parsedIndicators,
      chartUrl: `https://www.tradingview.com/chart/?symbol=IDX%3A${encodeURIComponent(cleanSymbol)}`,
    };
  }

  streamRealtimeRecommendation(
    symbol: string,
    options?: {
      intervalMs?: number;
      tradingViewIndicators?: string[];
      foreignFlowBillion?: number;
      brokerNetBuyTop3Billion?: number;
      strategyStyle?: StrategyStyle;
    },
  ): Observable<MessageEvent> {
    const intervalMs = Math.max(5000, options?.intervalMs ?? 15000);

    return timer(0, intervalMs).pipe(
      switchMap(() =>
        from(this.buildRealtimeRecommendation(symbol, options)).pipe(
          map((payload) => ({ data: payload })),
          catchError((error) =>
            of({
              data: {
                type: 'error',
                symbol: this.normalizeIdxSymbol(symbol),
                message:
                  error instanceof Error
                    ? error.message
                    : 'Realtime stream gagal',
              },
            }),
          ),
        ),
      ),
    );
  }

  async generateAutoRecommendation(payload: AutoRecommendationRequestDto) {
    const marketData = await this.getMarketData(payload.symbol);

    const recommendationPayload: StockAnalysisRequestDto = {
      symbol: marketData.symbol,
      closePrice: marketData.closePrice,
      rsi: marketData.indicators.rsi,
      macdHistogram: marketData.indicators.macdHistogram,
      volumeRatio: marketData.indicators.volumeRatio,
      liquiditySweep: payload.liquiditySweep,
      bidOfferImbalance: payload.bidOfferImbalance,
      ema20: marketData.indicators.ema20,
      ema50: marketData.indicators.ema50,
      foreignFlowBillion: payload.foreignFlowBillion,
      brokerNetBuyTop3Billion: payload.brokerNetBuyTop3Billion,
      tradingViewIndicators: payload.tradingViewIndicators,
      stochK: marketData.indicators.stochastic?.k ?? undefined,
      stochD: marketData.indicators.stochastic?.d ?? undefined,
      stochSignal: marketData.indicators.stochastic?.signal ?? 'NONE',
    };

    const recommendation = this.generateRecommendation(recommendationPayload);

    return {
      ...recommendation,
      marketData,
      recommendation,
    };
  }

  generateRecommendation(payload: StockAnalysisRequestDto) {
    const longScore = this.calculateLongScore(payload);
    const shortScore = this.calculateShortScore(payload);
    const ml = this.getMlPrediction(payload);
    const marketBias = this.getMarketBias(
      longScore,
      shortScore,
      ml.probabilityBuy,
    );

    return {
      symbol: payload.symbol.toUpperCase(),
      generatedAt: new Date().toISOString(),
      methodology: [
        'TECHNICAL_INDICATORS',
        'STOCHASTIC_CONFIRMATION',
        'LIQUIDITY_SWEEP',
        'BID_OFFER',
      ],
      marketBias,
      scoring: {
        longScore,
        shortScore,
        confidence: this.getConfidence(
          longScore,
          shortScore,
          ml.probabilityBuy,
        ),
        mlProbabilityBuy: this.round(ml.probabilityBuy),
        mlSignal: ml.signal,
        mlNote:
          'Probabilitas BUY dari model logistic regression yang bisa dilatih ulang memakai data historis Anda.',
      },
      brokerSummary: {
        foreignFlowBillion: payload.foreignFlowBillion,
        top3BrokerNetBuyBillion: payload.brokerNetBuyTop3Billion,
        interpretation:
          payload.foreignFlowBillion > 0 && payload.brokerNetBuyTop3Billion > 0
            ? 'Afirmasi akumulasi dari asing dan broker utama.'
            : payload.foreignFlowBillion < 0 &&
                payload.brokerNetBuyTop3Billion < 0
              ? 'Distribusi dominan, perlu disiplin risk management.'
              : 'Flow campuran, prioritaskan konfirmasi harga dan volume.',
      },
      strategies: {
        dayTrading: this.buildStrategy(payload.closePrice, marketBias, {
          style: 'DAY_TRADING',
          entryBufferPercent: 0.25,
          takeProfitPercent: 1.8,
          trailingStopPercent: 0.5,
          stopLossPercent: 0.8,
        }),
        swingTrading: this.buildStrategy(payload.closePrice, marketBias, {
          style: 'SWING_TRADING',
          entryBufferPercent: 0.5,
          takeProfitPercent: 6,
          trailingStopPercent: 1.5,
          stopLossPercent: 3,
        }),
        scalping: this.buildStrategy(payload.closePrice, marketBias, {
          style: 'SCALPING',
          entryBufferPercent: 0.15,
          takeProfitPercent: 0.9,
          trailingStopPercent: 0.25,
          stopLossPercent: 0.45,
        }),
      },
      tradingView: this.getTradingViewConfig(
        payload.symbol,
        payload.tradingViewIndicators,
      ),
      disclaimer:
        'Rekomendasi ini bersifat edukatif, bukan nasihat keuangan. Tetap lakukan analisis mandiri.',
    };
  }

  trainMlModel(payload: TrainMlModelRequestDto) {
    const learningRate = payload.learningRate ?? 0.08;
    const epochs = payload.epochs ?? 250;

    const gradients: MlFeatureWeights = {
      rsi: 0,
      macdHistogram: 0,
      volumeRatio: 0,
      bidOfferImbalance: 0,
      emaSpreadPercent: 0,
      foreignFlowBillion: 0,
      brokerNetBuyTop3Billion: 0,
    };

    for (let epoch = 0; epoch < epochs; epoch++) {
      gradients.rsi = 0;
      gradients.macdHistogram = 0;
      gradients.volumeRatio = 0;
      gradients.bidOfferImbalance = 0;
      gradients.emaSpreadPercent = 0;
      gradients.foreignFlowBillion = 0;
      gradients.brokerNetBuyTop3Billion = 0;
      let biasGradient = 0;

      for (const sample of payload.samples) {
        const features = this.normalizeMlFeatures({
          rsi: sample.rsi,
          macdHistogram: sample.macdHistogram,
          volumeRatio: sample.volumeRatio,
          bidOfferImbalance: sample.bidOfferImbalance,
          emaSpreadPercent: sample.emaSpreadPercent,
          foreignFlowBillion: sample.foreignFlowBillion,
          brokerNetBuyTop3Billion: sample.brokerNetBuyTop3Billion,
        });

        const y = sample.target === MlTargetSignal.BUY ? 1 : 0;
        const p = this.sigmoid(
          this.dot(features, this.mlWeights) + this.mlBias,
        );
        const error = p - y;

        gradients.rsi += error * features.rsi;
        gradients.macdHistogram += error * features.macdHistogram;
        gradients.volumeRatio += error * features.volumeRatio;
        gradients.bidOfferImbalance += error * features.bidOfferImbalance;
        gradients.emaSpreadPercent += error * features.emaSpreadPercent;
        gradients.foreignFlowBillion += error * features.foreignFlowBillion;
        gradients.brokerNetBuyTop3Billion +=
          error * features.brokerNetBuyTop3Billion;
        biasGradient += error;
      }

      const size = payload.samples.length;
      this.mlWeights.rsi -= learningRate * (gradients.rsi / size);
      this.mlWeights.macdHistogram -=
        learningRate * (gradients.macdHistogram / size);
      this.mlWeights.volumeRatio -=
        learningRate * (gradients.volumeRatio / size);
      this.mlWeights.bidOfferImbalance -=
        learningRate * (gradients.bidOfferImbalance / size);
      this.mlWeights.emaSpreadPercent -=
        learningRate * (gradients.emaSpreadPercent / size);
      this.mlWeights.foreignFlowBillion -=
        learningRate * (gradients.foreignFlowBillion / size);
      this.mlWeights.brokerNetBuyTop3Billion -=
        learningRate * (gradients.brokerNetBuyTop3Billion / size);
      this.mlBias -= learningRate * (biasGradient / size);
    }

    const accuracy = this.getTrainingAccuracy(payload.samples);

    this.mlTrainingMeta = {
      trainedSamples: payload.samples.length,
      epochs,
      learningRate,
      lastTrainedAt: new Date().toISOString(),
    };

    return {
      status: 'MODEL_UPDATED',
      training: {
        ...this.mlTrainingMeta,
        trainAccuracy: this.round(accuracy * 100),
      },
      weights: {
        ...this.mlWeights,
        bias: this.round(this.mlBias),
      },
    };
  }

  private calculateLongScore(payload: StockAnalysisRequestDto) {
    let score = 0;

    if (payload.rsi >= 50 && payload.rsi <= 68) score += 2;
    if (payload.macdHistogram > 0) score += 2;
    if (payload.closePrice > payload.ema20) score += 2;
    if (payload.ema20 > payload.ema50) score += 1;
    if (payload.volumeRatio >= 1.2) score += 2;
    if (payload.bidOfferImbalance >= 0.2) score += 2;
    if (payload.liquiditySweep === LiquiditySweepSignal.BULLISH) score += 2;
    if (payload.foreignFlowBillion > 0) score += 1;
    if (payload.brokerNetBuyTop3Billion > 0) score += 1;
    if (payload.stochSignal === 'GOLDEN_CROSS') score += 2;
    if (payload.stochSignal === 'DEAD_CROSS') score -= 2;
    if (
      payload.stochK !== undefined &&
      payload.stochD !== undefined &&
      payload.stochK > payload.stochD
    ) {
      score += 1;
    }

    return score;
  }

  private calculateShortScore(payload: StockAnalysisRequestDto) {
    let score = 0;

    if (payload.rsi <= 45) score += 2;
    if (payload.macdHistogram < 0) score += 2;
    if (payload.closePrice < payload.ema20) score += 2;
    if (payload.ema20 < payload.ema50) score += 1;
    if (payload.volumeRatio >= 1.2) score += 1;
    if (payload.bidOfferImbalance <= -0.2) score += 2;
    if (payload.liquiditySweep === LiquiditySweepSignal.BEARISH) score += 2;
    if (payload.foreignFlowBillion < 0) score += 1;
    if (payload.brokerNetBuyTop3Billion < 0) score += 1;
    if (payload.stochSignal === 'DEAD_CROSS') score += 2;
    if (payload.stochSignal === 'GOLDEN_CROSS') score -= 2;
    if (
      payload.stochK !== undefined &&
      payload.stochD !== undefined &&
      payload.stochK < payload.stochD
    ) {
      score += 1;
    }

    return score;
  }

  private buildSupportResistanceLevels(candles: CandlePoint[]) {
    const sample = candles.slice(-Math.min(candles.length, 120));
    if (sample.length < 10) {
      return {
        supports: [],
        resistances: [],
        nearestSupport: null,
        nearestResistance: null,
      };
    }

    const lows = sample.map((c) => c.l).sort((a, b) => a - b);
    const highs = sample.map((c) => c.h).sort((a, b) => b - a);
    const lastClose = sample[sample.length - 1].c;

    const pick = (arr: number[], ratio: number) =>
      arr[
        Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * ratio)))
      ];

    const supportsRaw = [pick(lows, 0.1), pick(lows, 0.25), pick(lows, 0.4)]
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    const resistancesRaw = [
      pick(highs, 0.1),
      pick(highs, 0.25),
      pick(highs, 0.4),
    ]
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    const supports = [...new Set(supportsRaw.map((v) => this.round(v)))];
    const resistances = [...new Set(resistancesRaw.map((v) => this.round(v)))];

    const nearestSupport =
      supports.filter((s) => s <= lastClose).sort((a, b) => b - a)[0] ?? null;
    const nearestResistance =
      resistances.filter((r) => r >= lastClose).sort((a, b) => a - b)[0] ??
      null;

    return {
      supports,
      resistances,
      nearestSupport,
      nearestResistance,
    };
  }

  private getMarketBias(
    longScore: number,
    shortScore: number,
    mlProbabilityBuy: number,
  ): MarketBias {
    const mlAdjustment = (mlProbabilityBuy - 0.5) * 6;
    const combinedScore = longScore - shortScore + mlAdjustment;

    if (combinedScore >= 3) return 'BULLISH';
    if (combinedScore <= -3) return 'BEARISH';
    return 'NEUTRAL';
  }

  private getConfidence(
    longScore: number,
    shortScore: number,
    mlProbabilityBuy: number,
  ) {
    const delta =
      Math.abs(longScore - shortScore) + Math.abs(mlProbabilityBuy - 0.5) * 4;

    if (delta >= 6) return 'HIGH';
    if (delta >= 3) return 'MEDIUM';
    return 'LOW';
  }

  private buildStrategy(
    closePrice: number,
    bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    config: {
      style: StrategyStyle;
      entryBufferPercent: number;
      takeProfitPercent: number;
      trailingStopPercent: number;
      stopLossPercent: number;
    },
  ) {
    if (bias === 'NEUTRAL') {
      return {
        style: config.style,
        recommendation: 'WAIT',
        entry: null,
        takeProfit: null,
        trailingStop: null,
        stopLoss: null,
        cutLoss: null,
        note: 'Bias netral, tunggu konfirmasi breakout/breakdown berikutnya.',
      };
    }

    const direction = bias === 'BULLISH' ? 1 : -1;
    const entry =
      closePrice * (1 + (direction * config.entryBufferPercent) / 100);
    const takeProfit =
      entry * (1 + (direction * config.takeProfitPercent) / 100);
    const trailingStop =
      entry * (1 - (direction * config.trailingStopPercent) / 100);
    const stopLoss = entry * (1 - (direction * config.stopLossPercent) / 100);

    return {
      style: config.style,
      recommendation: bias === 'BULLISH' ? 'BUY' : 'SELL',
      entry: this.round(entry),
      takeProfit: this.round(takeProfit),
      trailingStop: this.round(trailingStop),
      stopLoss: this.round(stopLoss),
      cutLoss: this.round(stopLoss),
      note:
        bias === 'BULLISH'
          ? 'Entry saat pullback valid di atas area demand intraday.'
          : 'Entry saat retest gagal ke area supply intraday.',
    };
  }

  private round(value: number) {
    return Math.round(value * 100) / 100;
  }

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private normalizeIdxSymbol(symbol: string) {
    const normalized = symbol.toUpperCase().trim().replace('.JK', '');
    return `${normalized}.JK`;
  }

  private getLastEma(values: number[], period: number) {
    const k = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private getLastRsi(values: number[], period: number) {
    if (values.length <= period) {
      throw new BadRequestException('Data tidak cukup untuk menghitung RSI.');
    }

    let gain = 0;
    let loss = 0;

    for (let i = 1; i <= period; i++) {
      const diff = values[i] - values[i - 1];
      if (diff >= 0) gain += diff;
      else loss += Math.abs(diff);
    }

    let avgGain = gain / period;
    let avgLoss = loss / period;

    for (let i = period + 1; i < values.length; i++) {
      const diff = values[i] - values[i - 1];
      const currentGain = diff > 0 ? diff : 0;
      const currentLoss = diff < 0 ? Math.abs(diff) : 0;

      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private getLastMacdHistogram(values: number[]) {
    const ema12Series = this.buildEmaSeries(values, 12);
    const ema26Series = this.buildEmaSeries(values, 26);
    const macdLine = ema12Series.map(
      (ema12, index) => ema12 - ema26Series[index],
    );
    const signalLine = this.buildEmaSeries(macdLine, 9);
    return macdLine[macdLine.length - 1] - signalLine[signalLine.length - 1];
  }

  private buildEmaSeries(values: number[], period: number) {
    const k = 2 / (period + 1);
    const series: number[] = [values[0]];
    for (let i = 1; i < values.length; i++) {
      series.push(values[i] * k + series[i - 1] * (1 - k));
    }
    return series;
  }

  private getVolumeRatio(volumes: number[], lookback: number) {
    const current = volumes[volumes.length - 1];
    const recent = volumes.slice(-lookback - 1, -1);
    const avg = recent.reduce((sum, vol) => sum + vol, 0) / recent.length;
    return avg > 0 ? current / avg : 1;
  }

  private maxFromSeries(values: number[], lookback: number) {
    const slice = values.slice(Math.max(0, values.length - lookback));
    return slice.length ? Math.max(...slice) : 0;
  }

  private minFromSeries(values: number[], lookback: number) {
    const slice = values.slice(Math.max(0, values.length - lookback));
    return slice.length ? Math.min(...slice) : 0;
  }

  private getMlPrediction(payload: StockAnalysisRequestDto) {
    const emaSpreadPercent =
      ((payload.ema20 - payload.ema50) / payload.closePrice) * 100;
    const features = this.normalizeMlFeatures({
      rsi: payload.rsi,
      macdHistogram: payload.macdHistogram,
      volumeRatio: payload.volumeRatio,
      bidOfferImbalance: payload.bidOfferImbalance,
      emaSpreadPercent,
      foreignFlowBillion: payload.foreignFlowBillion,
      brokerNetBuyTop3Billion: payload.brokerNetBuyTop3Billion,
    });

    const probabilityBuy = this.sigmoid(
      this.dot(features, this.mlWeights) + this.mlBias,
    );
    const signal =
      probabilityBuy >= 0.58 ? 'BUY' : probabilityBuy <= 0.42 ? 'SELL' : 'HOLD';

    return { probabilityBuy, signal };
  }

  private normalizeMlFeatures(input: MlFeatureWeights): MlFeatureWeights {
    return {
      rsi: (input.rsi - 50) / 50,
      macdHistogram: input.macdHistogram,
      volumeRatio: (input.volumeRatio - 1) / 2,
      bidOfferImbalance: input.bidOfferImbalance,
      emaSpreadPercent: input.emaSpreadPercent / 10,
      foreignFlowBillion: input.foreignFlowBillion / 100,
      brokerNetBuyTop3Billion: input.brokerNetBuyTop3Billion / 100,
    };
  }

  private dot(features: MlFeatureWeights, weights: MlFeatureWeights) {
    return (
      features.rsi * weights.rsi +
      features.macdHistogram * weights.macdHistogram +
      features.volumeRatio * weights.volumeRatio +
      features.bidOfferImbalance * weights.bidOfferImbalance +
      features.emaSpreadPercent * weights.emaSpreadPercent +
      features.foreignFlowBillion * weights.foreignFlowBillion +
      features.brokerNetBuyTop3Billion * weights.brokerNetBuyTop3Billion
    );
  }

  private sigmoid(value: number) {
    return 1 / (1 + Math.exp(-value));
  }

  private getTrainingAccuracy(samples: TrainMlModelRequestDto['samples']) {
    let correct = 0;
    for (const sample of samples) {
      const p = this.sigmoid(
        this.dot(
          this.normalizeMlFeatures({
            rsi: sample.rsi,
            macdHistogram: sample.macdHistogram,
            volumeRatio: sample.volumeRatio,
            bidOfferImbalance: sample.bidOfferImbalance,
            emaSpreadPercent: sample.emaSpreadPercent,
            foreignFlowBillion: sample.foreignFlowBillion,
            brokerNetBuyTop3Billion: sample.brokerNetBuyTop3Billion,
          }),
          this.mlWeights,
        ) + this.mlBias,
      );

      const prediction = p >= 0.5 ? MlTargetSignal.BUY : MlTargetSignal.SELL;
      if (prediction === sample.target) correct += 1;
    }

    return correct / samples.length;
  }
}
