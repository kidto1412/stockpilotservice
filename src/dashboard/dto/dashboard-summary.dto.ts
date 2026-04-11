import { IsDateString, IsOptional } from 'class-validator';

export class DashboardSummaryQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
