import { Controller, Post, Body } from '@nestjs/common';
import { PurchaseService } from './purchase.service';
import { CreatePurchaseDto } from './dto/request-purchase.dto';
import { StoreId } from 'src/common/decorators/user.decorator';

@Controller('purchases')
export class PurchaseController {
  constructor(private purchaseService: PurchaseService) {}

  @Post()
  create(@Body() dto: CreatePurchaseDto, @StoreId() storeId: string) {
    return this.purchaseService.create(dto, storeId);
  }
}
