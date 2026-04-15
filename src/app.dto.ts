import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
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
