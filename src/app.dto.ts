import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum LiquiditySweepSignal {
  BULLISH = 'BULLISH',
  BEARISH = 'BEARISH',
  NONE = 'NONE',
}

export class StockAnalysisRequestDto {
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsNumber()
  @Min(1)
  closePrice: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  rsi: number;

  @IsNumber()
  macdHistogram: number;

  @IsNumber()
  @Min(0)
  volumeRatio: number;

  @IsEnum(LiquiditySweepSignal)
  liquiditySweep: LiquiditySweepSignal;

  @IsNumber()
  @Min(-1)
  @Max(1)
  bidOfferImbalance: number;

  @IsNumber()
  ema20: number;

  @IsNumber()
  ema50: number;

  @IsNumber()
  foreignFlowBillion: number;

  @IsNumber()
  brokerNetBuyTop3Billion: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tradingViewIndicators?: string[];
}

export class AutoRecommendationRequestDto {
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsEnum(LiquiditySweepSignal)
  liquiditySweep: LiquiditySweepSignal;

  @IsNumber()
  @Min(-1)
  @Max(1)
  bidOfferImbalance: number;

  @IsNumber()
  foreignFlowBillion: number;

  @IsNumber()
  brokerNetBuyTop3Billion: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tradingViewIndicators?: string[];
}

export enum MlTargetSignal {
  BUY = 'BUY',
  SELL = 'SELL',
}

export class MlTrainingSampleDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  rsi: number;

  @IsNumber()
  macdHistogram: number;

  @IsNumber()
  @Min(0)
  volumeRatio: number;

  @IsNumber()
  @Min(-1)
  @Max(1)
  bidOfferImbalance: number;

  @IsNumber()
  emaSpreadPercent: number;

  @IsNumber()
  foreignFlowBillion: number;

  @IsNumber()
  brokerNetBuyTop3Billion: number;

  @IsEnum(MlTargetSignal)
  target: MlTargetSignal;
}

export class TrainMlModelRequestDto {
  @IsArray()
  @ArrayMinSize(20)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => MlTrainingSampleDto)
  samples: MlTrainingSampleDto[];

  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  @Max(1)
  learningRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(2000)
  epochs?: number;
}

export class ChartIndicatorQueryDto {
  @IsOptional()
  @IsIn(['1m', '5m', '15m', '30m', '60m', '4h', '1d', '1w', '1mo'])
  interval?: '1m' | '5m' | '15m' | '30m' | '60m' | '4h' | '1d' | '1w' | '1mo';

  @IsOptional()
  @IsIn(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y'])
  range?: '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | '10y';

  @IsOptional()
  @IsIn(['daily', 'swing', 'scalping'])
  style?: 'daily' | 'swing' | 'scalping';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1000)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(100)
  rsiPeriod?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(100)
  macdFast?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(200)
  macdSlow?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(100)
  macdSignal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(50)
  stochKPeriod?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  stochKSmooth?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  stochDPeriod?: number;

  @IsOptional()
  @IsString()
  emaPeriods?: string;
}

export class MarketDataListQueryDto {
  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit = 200;
}
