import { IsNotEmpty, IsString } from 'class-validator';

export class CreateCategoryDTO {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  storeId: string;
}

export class UpdateCategoryDTO extends CreateCategoryDTO {
  @IsNotEmpty()
  @IsString()
  id: string;
}
