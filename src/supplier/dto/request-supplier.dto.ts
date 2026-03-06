import { PartialType } from '@nestjs/mapped-types';
import { IsString, IsOptional, IsEmail } from 'class-validator';

export class CreateSupplierDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsString()
  storeId: string;
}
export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}
