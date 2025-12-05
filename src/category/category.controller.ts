import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { CategoryService } from './category.service';
import { CreateCategoryDTO } from './dto/category.dto';
import { StoreId } from 'src/common/decorators/user.decorator';
import {
  CREATED,
  DELETED,
  UPDATED,
} from 'src/common/constant/operations.constant';

@Controller('category')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Post()
  async created(@Body() dto: CreateCategoryDTO, @StoreId() storeId: string) {
    await this.categoryService.create(dto, storeId);
    return CREATED;
  }

  @Get()
  findAll(@Req() req) {
    return this.categoryService.findAll(req.user.storeId);
  }

  @Get('/pagination')
  findPagination(
    @Query('page') page = 1,
    @Query('size') size = 10,
    @Req() req,
  ) {
    const pageNumber = Math.max(1, Number(page));
    const pageSize = Math.max(1, Number(size));
    return this.categoryService.getPagination(
      pageNumber,
      pageSize,
      req.user.storeId,
    );
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: CreateCategoryDTO) {
    await this.categoryService.update(id, dto);
    return UPDATED;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.categoryService.remove(id);
    return DELETED;
  }
}
