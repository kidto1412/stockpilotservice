import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { DiscountService } from './discount.service';
import { CreateDiscountDto, UpdateDiscountDto } from './dto/dicount.dto';
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

  @Get(':id')
  findOne(@Param('id') id: string, @StoreId() storeId: string) {
    return this.service.findOne(id, storeId);
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
