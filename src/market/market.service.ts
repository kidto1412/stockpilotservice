import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  EventQueryDto,
  RecommendationListQueryDto,
  RecommendationMode,
  RecommendationStyle,
  RecommendationTimeframe,
  SyncStatusQueryDto,
  TechnicalQueryDto,
} from './dto/market-query.dto';

type TechnicalRow = {
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
  created_at: Date;
};

type EventRow = {
  source: string;
  event_type: string;
  symbol: string | null;
  title: string;
  event_date: Date | null;
  reference_url: string | null;
  external_id: string | null;
  raw_payload: unknown;
  created_at: Date;
};

type SyncRunRow = {
  source: string;
  started_at: Date;
  finished_at: Date | null;
  status: string;
  message: string;
  created_at: Date;
};

type RecommendationBaseRow = {
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
  prev_snapshot_at: Date | null;
  prev_close_price: number | null;
  prev_volume: bigint | number | null;
  prev_macd: number | null;
  prev_macd_signal: number | null;
  prev_ema20: number | null;
  prev_ema50: number | null;
  prev_raw_payload: unknown;
};

@Injectable()
export class MarketService {
  constructor(private readonly prisma: PrismaService) {}

  async getTechnical(query: TechnicalQueryDto) {
    const where = this.buildTechnicalWhere(query);

    const rows = await this.prisma.$queryRaw<TechnicalRow[]>(Prisma.sql`
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
        created_at
      FROM market_technical_snapshot
      ${where}
      ORDER BY snapshot_at DESC
      LIMIT ${query.limit}
    `);

    return rows.map((row) => ({
      source: row.source,
      symbol: row.symbol,
      snapshotAt: row.snapshot_at,
      closePrice: row.close_price,
      volume:
        typeof row.volume === 'bigint'
          ? Number(row.volume)
          : (row.volume ?? null),
      indicators: {
        rsi: row.rsi,
        macd: row.macd,
        macdSignal: row.macd_signal,
        ema20: row.ema20,
        ema50: row.ema50,
      },
      rawPayload: row.raw_payload,
      createdAt: row.created_at,
    }));
  }

  async getEvents(query: EventQueryDto) {
    const where = this.buildEventWhere(query);

    const rows = await this.prisma.$queryRaw<EventRow[]>(Prisma.sql`
      SELECT
        source,
        event_type,
        symbol,
        title,
        event_date,
        reference_url,
        external_id,
        raw_payload,
        created_at
      FROM market_event_official
      ${where}
      ORDER BY COALESCE(event_date, created_at::date) DESC, created_at DESC
      LIMIT ${query.limit}
    `);

    return rows.map((row) => ({
      source: row.source,
      type: row.event_type,
      symbol: row.symbol,
      title: row.title,
      eventDate: row.event_date,
      referenceUrl: row.reference_url,
      externalId: row.external_id,
      rawPayload: row.raw_payload,
      createdAt: row.created_at,
    }));
  }

  async getSyncStatus(query: SyncStatusQueryDto) {
    const conditions: Prisma.Sql[] = [];

    if (query.source) {
      conditions.push(Prisma.sql`source = ${query.source.toUpperCase()}`);
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<SyncRunRow[]>(Prisma.sql`
      SELECT source, started_at, finished_at, status, message, created_at
      FROM sync_run_log
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${query.limit}
    `);

    return rows.map((row) => ({
      source: row.source,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      status: row.status,
      message: row.message,
      createdAt: row.created_at,
    }));
  }

  async getRecommendations(query: RecommendationListQueryDto) {
    const normalizedSource = (query.source ?? 'TRADINGVIEW').toUpperCase();
    const style = query.style ?? 'SWING';
    const mode = query.mode ?? 'COMBINED';
    const timeframe = query.timeframe ?? this.getDefaultTimeframeByStyle(style);
    const styleConfig = this.getStyleConfig(style, query.stochSetting);
    const stochBuyThreshold =
      query.stochBuyThreshold ?? styleConfig.stochBuyThreshold;
    const minVolumeRatio = query.minVolumeRatio ?? styleConfig.minVolumeRatio;
    const crossLookback =
      query.crossLookback ?? this.getDefaultLookbackByTimeframe(timeframe);

    const rows = await this.prisma.$queryRaw<
      RecommendationBaseRow[]
    >(Prisma.sql`
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
        WHERE source = ${normalizedSource}
      ), latest AS (
        SELECT * FROM ranked WHERE rn = 1
      ), previous AS (
        SELECT * FROM ranked WHERE rn = 2
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
        p.snapshot_at AS prev_snapshot_at,
        p.close_price AS prev_close_price,
        p.volume AS prev_volume,
        p.macd AS prev_macd,
        p.macd_signal AS prev_macd_signal,
        p.ema20 AS prev_ema20,
        p.ema50 AS prev_ema50,
        p.raw_payload AS prev_raw_payload
      FROM latest l
      LEFT JOIN previous p ON p.symbol = l.symbol
      WHERE l.close_price IS NOT NULL
      ORDER BY l.snapshot_at DESC
      LIMIT ${Math.max(query.limit * 5, 100)}
    `);

    const picked = rows
      .map((row) =>
        this.buildRecommendation(row, style, mode, {
          stochasticSetting: styleConfig.stochasticSetting,
          stochBuyThreshold,
          minVolumeRatio,
        }),
      )
      .filter((item) => item.isMatch)
      .sort((a, b) => b.score - a.score)
      .slice(0, query.limit);

    const finalPicked =
      picked.length > 0
        ? picked
        : rows
            .map((row) =>
              this.buildRecommendationState(row, style, mode, {
                stochasticSetting: styleConfig.stochasticSetting,
                stochBuyThreshold,
                minVolumeRatio,
              }),
            )
            .filter((item) => item.isMatch)
            .sort((a, b) => b.score - a.score)
            .slice(0, query.limit);

    return {
      config: {
        source: normalizedSource,
        style,
        timeframe,
        mode,
        stochasticSetting: styleConfig.stochasticSetting,
        stochBuyThreshold,
        minVolumeRatio,
        crossLookback,
        matchPolicy: picked.length > 0 ? 'STRICT_CROSS' : 'STATE_FALLBACK',
      },
      count: finalPicked.length,
      items: finalPicked.map((item) => item.payload),
    };
  }

  private getDefaultTimeframeByStyle(
    style: RecommendationStyle,
  ): RecommendationTimeframe {
    if (style === 'SWING') {
      return '1D';
    }

    if (style === 'SCALPING') {
      return '5m';
    }

    // DAILY pada API ini diposisikan sebagai day-trade intraday.
    return '15m';
  }

  private getDefaultLookbackByTimeframe(timeframe: RecommendationTimeframe) {
    if (timeframe === '1D') {
      return 20;
    }

    if (timeframe === '15m') {
      return 12;
    }

    return 8;
  }

  private buildTechnicalWhere(query: TechnicalQueryDto): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];

    if (query.symbol) {
      conditions.push(Prisma.sql`symbol = ${query.symbol.toUpperCase()}`);
    }

    if (query.source) {
      conditions.push(Prisma.sql`source = ${query.source.toUpperCase()}`);
    }

    if (query.from) {
      conditions.push(Prisma.sql`snapshot_at >= ${new Date(query.from)}`);
    }

    if (query.to) {
      conditions.push(Prisma.sql`snapshot_at <= ${new Date(query.to)}`);
    }

    if (conditions.length === 0) {
      return Prisma.sql``;
    }

    return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
  }

  private buildEventWhere(query: EventQueryDto): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];

    if (query.symbol) {
      conditions.push(Prisma.sql`symbol = ${query.symbol.toUpperCase()}`);
    }

    if (query.source) {
      conditions.push(Prisma.sql`source = ${query.source.toUpperCase()}`);
    }

    if (query.type) {
      conditions.push(Prisma.sql`event_type = ${query.type}`);
    }

    if (query.from) {
      conditions.push(
        Prisma.sql`COALESCE(event_date, created_at::date) >= ${new Date(query.from)}`,
      );
    }

    if (query.to) {
      conditions.push(
        Prisma.sql`COALESCE(event_date, created_at::date) <= ${new Date(query.to)}`,
      );
    }

    if (conditions.length === 0) {
      return Prisma.sql``;
    }

    return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
  }

  private buildRecommendation(
    row: RecommendationBaseRow,
    style: RecommendationStyle,
    mode: RecommendationMode,
    styleConfig: {
      stochasticSetting: string;
      stochBuyThreshold: number;
      minVolumeRatio: number;
    },
  ) {
    const stochK = this.getStochValue(row.raw_payload, 8);
    const stochD = this.getStochValue(row.raw_payload, 9);
    const prevStochK = this.getStochValue(row.prev_raw_payload, 8);
    const prevStochD = this.getStochValue(row.prev_raw_payload, 9);

    const macdGoldenCross =
      row.macd !== null &&
      row.macd_signal !== null &&
      row.prev_macd !== null &&
      row.prev_macd_signal !== null &&
      row.prev_macd <= row.prev_macd_signal &&
      row.macd > row.macd_signal;

    const stochGoldenCross =
      stochK !== null &&
      stochD !== null &&
      prevStochK !== null &&
      prevStochD !== null &&
      prevStochK <= prevStochD &&
      stochK > stochD &&
      stochK <= styleConfig.stochBuyThreshold;

    const volumeRatio = this.getVolumeRatio(row.volume, row.prev_volume);
    const liquiditySweepBullish =
      row.close_price !== null &&
      row.ema20 !== null &&
      row.prev_close_price !== null &&
      row.prev_ema20 !== null &&
      row.prev_close_price <= row.prev_ema20 &&
      row.close_price > row.ema20 &&
      volumeRatio !== null &&
      volumeRatio >= styleConfig.minVolumeRatio;

    const isMatch = this.matchMode({
      mode,
      macdGoldenCross,
      stochGoldenCross,
      liquiditySweepBullish,
    });

    const score =
      (macdGoldenCross ? 40 : 0) +
      (stochGoldenCross ? 30 : 0) +
      (liquiditySweepBullish ? 20 : 0) +
      (row.rsi !== null && row.rsi >= 45 && row.rsi <= 70 ? 10 : 0);

    return {
      isMatch,
      score,
      payload: {
        symbol: row.symbol,
        source: row.source,
        snapshotAt: row.snapshot_at,
        style,
        score,
        signal: isMatch ? 'BUY_CANDIDATE' : 'WAIT',
        indicators: {
          closePrice: row.close_price,
          rsi: row.rsi,
          macd: row.macd,
          macdSignal: row.macd_signal,
          stochK,
          stochD,
          ema20: row.ema20,
          ema50: row.ema50,
          volumeRatio,
        },
        checks: {
          macdGoldenCross,
          stochGoldenCross,
          liquiditySweepBullish,
        },
        rule: {
          mode,
          stochasticSetting: styleConfig.stochasticSetting,
          signalType: 'STRICT_CROSS',
        },
      },
    };
  }

  private buildRecommendationState(
    row: RecommendationBaseRow,
    style: RecommendationStyle,
    mode: RecommendationMode,
    styleConfig: {
      stochasticSetting: string;
      stochBuyThreshold: number;
      minVolumeRatio: number;
    },
  ) {
    const stochK = this.getStochValue(row.raw_payload, 8);
    const stochD = this.getStochValue(row.raw_payload, 9);

    const macdBullish =
      row.macd !== null &&
      row.macd_signal !== null &&
      row.macd > row.macd_signal;

    const stochBullish =
      stochK !== null &&
      stochD !== null &&
      stochK > stochD &&
      stochK <= styleConfig.stochBuyThreshold;

    const volumeRatio = this.getVolumeRatio(row.volume, row.prev_volume);
    const liquiditySweepBullish =
      row.close_price !== null &&
      row.ema20 !== null &&
      row.prev_close_price !== null &&
      row.prev_ema20 !== null &&
      row.prev_close_price <= row.prev_ema20 &&
      row.close_price > row.ema20 &&
      volumeRatio !== null &&
      volumeRatio >= styleConfig.minVolumeRatio;

    const isMatch = this.matchMode({
      mode,
      macdGoldenCross: macdBullish,
      stochGoldenCross: stochBullish,
      liquiditySweepBullish,
    });

    const score =
      (macdBullish ? 30 : 0) +
      (stochBullish ? 25 : 0) +
      (liquiditySweepBullish ? 20 : 0) +
      (row.rsi !== null && row.rsi >= 45 && row.rsi <= 70 ? 10 : 0);

    return {
      isMatch,
      score,
      payload: {
        symbol: row.symbol,
        source: row.source,
        snapshotAt: row.snapshot_at,
        style,
        score,
        signal: isMatch ? 'BUY_CANDIDATE' : 'WAIT',
        indicators: {
          closePrice: row.close_price,
          rsi: row.rsi,
          macd: row.macd,
          macdSignal: row.macd_signal,
          stochK,
          stochD,
          ema20: row.ema20,
          ema50: row.ema50,
          volumeRatio,
        },
        checks: {
          macdGoldenCross: macdBullish,
          stochGoldenCross: stochBullish,
          liquiditySweepBullish,
        },
        rule: {
          mode,
          stochasticSetting: styleConfig.stochasticSetting,
          signalType: 'STATE_FALLBACK',
        },
      },
    };
  }

  private getStyleConfig(
    style: RecommendationStyle,
    stochSettingOverride?: '14,3,3' | '10,5,5' | '5,3,3',
  ) {
    if (stochSettingOverride === '14,3,3') {
      return {
        stochasticSetting: '14,3,3',
        stochBuyThreshold: 75,
        minVolumeRatio: 0.9,
      };
    }

    if (stochSettingOverride === '5,3,3') {
      return {
        stochasticSetting: '5,3,3',
        stochBuyThreshold: 90,
        minVolumeRatio: 1.2,
      };
    }

    if (stochSettingOverride === '10,5,5') {
      return {
        stochasticSetting: '10,5,5',
        stochBuyThreshold: 80,
        minVolumeRatio: 1,
      };
    }

    if (style === 'DAILY') {
      return {
        stochasticSetting: '14,3,3',
        stochBuyThreshold: 75,
        minVolumeRatio: 0.9,
      };
    }

    if (style === 'SCALPING') {
      return {
        stochasticSetting: '5,3,3',
        stochBuyThreshold: 90,
        minVolumeRatio: 1.2,
      };
    }

    return {
      stochasticSetting: '10,5,5',
      stochBuyThreshold: 80,
      minVolumeRatio: 1,
    };
  }

  private matchMode(input: {
    mode: RecommendationMode;
    macdGoldenCross: boolean;
    stochGoldenCross: boolean;
    liquiditySweepBullish: boolean;
  }) {
    if (input.mode === 'LIQUIDITY_SWEEP') {
      return input.liquiditySweepBullish;
    }

    if (input.mode === 'MACD_STOCH') {
      return input.macdGoldenCross && input.stochGoldenCross;
    }

    return (
      input.macdGoldenCross &&
      input.stochGoldenCross &&
      input.liquiditySweepBullish
    );
  }

  private getStochValue(rawPayload: unknown, index: number): number | null {
    if (!rawPayload || typeof rawPayload !== 'object') {
      return null;
    }

    const payload = rawPayload as { d?: unknown[] };
    if (!Array.isArray(payload.d) || payload.d.length <= index) {
      return null;
    }

    const value = payload.d[index];
    if (typeof value !== 'number') {
      return null;
    }

    return value;
  }

  private getVolumeRatio(
    currentVolume: bigint | number | null,
    previousVolume: bigint | number | null,
  ): number | null {
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
}
