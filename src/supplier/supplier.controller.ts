import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { SupplierService } from './supplier.service';
import {
  CreateSupplierDto,
  UpdateSupplierDto,
} from './dto/request-supplier.dto';
import { StoreId } from 'src/common/decorators/user.decorator';

@Controller('suppliers')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Post()
  create(@Body() dto: CreateSupplierDto, @StoreId() storeId: string) {
    return this.supplierService.create(dto, storeId);
  }

  @Get('pagination')
  getPagination(
    @Query('page') page: number,
    @Query('size') size: number,
    @StoreId() storeId: string,
  ) {
    return this.supplierService.getPagination(
      Number(page),
      Number(size),
      storeId,
    );
  }

  @Get()
  findAll(@StoreId() storeId: string) {
    return this.supplierService.findAll(storeId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @StoreId() storeId: string) {
    return this.supplierService.findOne(id, storeId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @StoreId() storeId: string,
  ) {
    return this.supplierService.update(id, dto, storeId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @StoreId() storeId: string) {
    return this.supplierService.remove(id, storeId);
  }
}
