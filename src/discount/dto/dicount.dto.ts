import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { DiscountType, DiscountValueType } from '@prisma/client';

export class CreateDiscountDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  // @IsString()
  // storeId?: string;

  @IsEnum(DiscountValueType)
  valueType: DiscountValueType;

  @IsNumber()
  @Min(0)
  value: number;
}

export class UpdateDiscountDto extends CreateDiscountDto {}
