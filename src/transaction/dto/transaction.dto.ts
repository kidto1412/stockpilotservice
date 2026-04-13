import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export enum SalesChartGroupBy {
  DAILY = 'DAILY',
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export enum SalesStatusFilter {
  ALL = 'ALL',
  DRAFT = 'DRAFT',
  COMPLETED = 'COMPLETED',
  CANCELED = 'CANCELED',
}

export class CreateTransactionItemDto {
  @IsString()
  productId: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  discountId?: string;
}

export class CreateTransactionDto {
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  transactionDiscountId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount?: number;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  paidAmount: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTransactionItemDto)
  items: CreateTransactionItemDto[];
}

export class TransactionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  size?: number;
}

export class SalesTransactionQueryDto extends TransactionQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsEnum(SalesStatusFilter)
  status?: SalesStatusFilter;
}

export class SalesSummaryQueryDto extends TransactionQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class SalesChartQueryDto extends SalesTransactionQueryDto {
  @IsOptional()
  @IsEnum(SalesChartGroupBy)
  groupBy?: SalesChartGroupBy;
}
