import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { StoreId } from 'src/common/decorators/user.decorator';
import { CREATED } from 'src/common/constant/operations.constant';
import {
  CreateExpenseStockMovementDto,
  StockMovementQueryDto,
} from './dto/stock-movement.dto';
import { StockMovementService } from './stock-movement.service';

@Controller('stock-movements')
export class StockMovementController {
  constructor(private readonly service: StockMovementService) {}

  @Get('history')
  history(@Query() query: StockMovementQueryDto, @StoreId() storeId: string) {
    return this.service.history(query, storeId);
  }

  @Get('products/:productId/history')
  historyByProduct(
    @Param('productId') productId: string,
    @Query() query: StockMovementQueryDto,
    @StoreId() storeId: string,
  ) {
    return this.service.historyByProduct(productId, query, storeId);
  }

  @Get('dashboard')
  dashboard(@Query() query: StockMovementQueryDto, @StoreId() storeId: string) {
    return this.service.dashboard(query, storeId);
  }

  @Post('expense')
  async createExpense(
    @Body() dto: CreateExpenseStockMovementDto,
    @StoreId() storeId: string,
  ) {
    await this.service.createExpenseOut(dto, storeId);
    return CREATED;
  }
}
