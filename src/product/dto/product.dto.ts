import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { DiscountValueType } from '@prisma/client';

export class ProductDiscountDto {
  id: string;
  name: string;
  valueType: DiscountValueType;
  value: number;
  description?: string;
}

export class ProductInlineDiscountDto {
  @IsOptional()
  @IsUUID()
  discountId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(DiscountValueType)
  valueType?: DiscountValueType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  value?: number;
}

export class CreateProductDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitValue?: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  cost: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  price: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  stock?: number;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  discountId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProductInlineDiscountDto)
  discount?: ProductInlineDiscountDto;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}
