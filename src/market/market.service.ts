import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  EventQueryDto,
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
}
