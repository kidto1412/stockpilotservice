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

@Controller('suppliers')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Post()
  create(@Body() dto: CreateSupplierDto, @Req() req) {
    return this.supplierService.create(dto, req.user.storeId);
  }

  @Get('pagination')
  getPagination(
    @Query('page') page: number,
    @Query('size') size: number,
    @Req() req,
  ) {
    return this.supplierService.getPagination(
      Number(page),
      Number(size),
      req.user.storeId,
    );
  }

  @Get()
  findAll(@Req() req) {
    return this.supplierService.findAll(req.user.storeId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req) {
    return this.supplierService.findOne(id, req.user.storeId);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSupplierDto, @Req() req) {
    return this.supplierService.update(id, dto, req.user.storeId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req) {
    return this.supplierService.remove(id, req.user.storeId);
  }
}
