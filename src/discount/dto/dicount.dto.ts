import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { DiscountType, DiscountValueType } from '@prisma/client';
import { PartialType } from '@nestjs/mapped-types';

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

export class UpdateDiscountDto extends PartialType(CreateDiscountDto) {}

export class AssignDiscountProductsDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  productIds: string[];
}
