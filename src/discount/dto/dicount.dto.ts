import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { DiscountType, DiscountValueType } from '@prisma/client';

export class CreateDiscountDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(DiscountType)
  type: DiscountType;

  @IsEnum(DiscountValueType)
  valueType: DiscountValueType;

  @IsNumber()
  @Min(0)
  value: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  minQty?: number;
}

export class UpdateDiscountDto extends CreateDiscountDto {}
