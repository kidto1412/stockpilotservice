import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DiscountService } from './discount.service';
import {
  AssignDiscountProductsDto,
  CreateDiscountDto,
  UpdateDiscountDto,
} from './dto/dicount.dto';
import { StoreId } from 'src/common/decorators/user.decorator';

@Controller('discounts')
export class DiscountController {
  constructor(private readonly service: DiscountService) {}

  @Post()
  create(@Body() dto: CreateDiscountDto, @StoreId() storeId: string) {
    return this.service.create(dto, storeId);
  }

  @Get()
  findAll(@StoreId() storeId: string) {
    return this.service.findAll(storeId);
  }
  @Get('pagination')
  findPagination(
    @Query('page') page = 1,
    @Query('size') size = 10,
    @StoreId() storeId: string,
  ) {
    const pageNumber = Math.max(1, Number(page));
    const pageSize = Math.max(1, Number(size));

    return this.service.getPagination(pageNumber, pageSize, storeId);
  }
  @Get(':id')
  findOne(@Param('id') id: string, @StoreId() storeId: string) {
    return this.service.findOneWithProducts(id, storeId);
  }

  @Patch(':id/products')
  assignProducts(
    @Param('id') id: string,
    @Body() dto: AssignDiscountProductsDto,
    @StoreId() storeId: string,
  ) {
    return this.service.assignProducts(id, dto.productIds, storeId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDiscountDto,
    @StoreId() storeId: string,
  ) {
    return this.service.update(id, dto, storeId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @StoreId() storeId: string) {
    return this.service.remove(id, storeId);
  }
}
