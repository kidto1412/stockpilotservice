import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { StoreId, CurrentUser } from 'src/common/decorators/user.decorator';
import { TransactionService } from './transaction.service';
import {
  CreateTransactionDto,
  SalesChartQueryDto,
  SalesTransactionQueryDto,
  SalesSummaryQueryDto,
  TransactionQueryDto,
} from './dto/transaction.dto';

@Controller('transactions')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Post()
  create(
    @Body() dto: CreateTransactionDto,
    @StoreId() storeId: string,
    @CurrentUser() user: any,
  ) {
    return this.transactionService.create(dto, storeId, user);
  }

  @Get()
  findAll(@Query() query: TransactionQueryDto, @StoreId() storeId: string) {
    return this.transactionService.findAll(query, storeId);
  }

  @Get('sales/pagination')
  findSalesPagination(
    @Query() query: SalesTransactionQueryDto,
    @StoreId() storeId: string,
  ) {
    return this.transactionService.findSalesPagination(query, storeId);
  }

  @Get('sales/summary')
  getSalesSummary(
    @Query() query: SalesSummaryQueryDto,
    @StoreId() storeId: string,
  ) {
    return this.transactionService.getSalesSummary(query, storeId);
  }

  @Get('sales/chart')
  getSalesChart(
    @Query() query: SalesChartQueryDto,
    @StoreId() storeId: string,
  ) {
    return this.transactionService.getSalesProfitLossChart(query, storeId);
  }

  @Get('sales/scan')
  scanSalesProduct(
    @Query('barcode') barcode: string,
    @Query('currentQuantity') currentQuantity: string | undefined,
    @StoreId() storeId: string,
  ) {
    const parsedCurrentQuantity =
      currentQuantity !== undefined ? Number(currentQuantity) : undefined;

    return this.transactionService.scanSalesProduct(
      barcode,
      storeId,
      parsedCurrentQuantity,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @StoreId() storeId: string) {
    return this.transactionService.findOne(id, storeId);
  }
}
