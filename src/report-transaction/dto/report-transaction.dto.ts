import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsPositive } from 'class-validator';
import { PaymentMethod, TransactionStatus } from '@prisma/client';

export enum ReportGroupBy {
  DAILY = 'DAILY',
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export enum ReportExportFormat {
  EXCEL = 'EXCEL',
  PDF = 'PDF',
}

export class ReportTransactionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  size?: number;

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
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;
}

export class ExportReportTransactionDto extends ReportTransactionQueryDto {
  @IsOptional()
  @IsEnum(ReportGroupBy)
  groupBy?: ReportGroupBy;

  @IsOptional()
  @IsEnum(ReportExportFormat)
  format?: ReportExportFormat;
}
