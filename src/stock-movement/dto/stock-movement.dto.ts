import { Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  IsDateString,
} from 'class-validator';
import { StockMovementType } from '@prisma/client';

export enum StockMovementSource {
  PURCHASE = 'PURCHASE',
  SALE = 'SALE',
  EXPENSE = 'EXPENSE',
  ADJUSTMENT = 'ADJUSTMENT',
  RETURN = 'RETURN',
}

export enum StockMovementDashboardGroupBy {
  DAILY = 'DAILY',
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export class CreateExpenseStockMovementDto {
  @IsUUID()
  productId: string;

  @Type(() => Number)
  @IsPositive()
  quantity: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class StockMovementQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  size?: number;

  @IsOptional()
  @IsEnum(StockMovementType)
  type?: StockMovementType;

  @IsOptional()
  @IsEnum(StockMovementSource)
  source?: StockMovementSource;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(StockMovementDashboardGroupBy)
  groupBy?: StockMovementDashboardGroupBy;
}
