import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { StoreId, CurrentUser } from 'src/common/decorators/user.decorator';
import { TransactionService } from './transaction.service';
import {
  CreateTransactionDto,
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

  @Get(':id')
  findOne(@Param('id') id: string, @StoreId() storeId: string) {
    return this.transactionService.findOne(id, storeId);
  }
}
