import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export type RecommendationStyle = 'DAILY' | 'SWING' | 'SCALPING';
export type RecommendationMode = 'COMBINED' | 'MACD_STOCH' | 'LIQUIDITY_SWEEP';

export class TechnicalQueryDto {
  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit = 100;
}

export class EventQueryDto {
  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsIn(['CORPORATE_ACTION', 'OFFICIAL_NEWS'])
  type?: 'CORPORATE_ACTION' | 'OFFICIAL_NEWS';

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit = 100;
}

export class SyncStatusQueryDto {
  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

export class RecommendationListQueryDto {
  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsIn(['DAILY', 'SWING', 'SCALPING'])
  style: RecommendationStyle = 'SWING';

  @IsOptional()
  @IsIn(['COMBINED', 'MACD_STOCH', 'LIQUIDITY_SWEEP'])
  mode: RecommendationMode = 'COMBINED';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 30;
}
