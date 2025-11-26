import {
  isDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateStoreDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  address: string;

  @IsNotEmpty()
  @IsString()
  province: string;

  @IsNotEmpty()
  @IsString()
  regency: string;

  @IsNotEmpty()
  @IsString()
  businessTypeId: string;

  @IsOptional()
  @IsString()
  logoUrl: string;

  @IsNotEmpty()
  @IsString()
  ownerId: string;
}

export class UpdateStoreDto extends CreateStoreDto {}
