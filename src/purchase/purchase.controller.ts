import { Controller, Post, Body, Req } from '@nestjs/common';
import { PurchaseService } from './purchase.service';
import { CreatePurchaseDto } from './dto/request-purchase.dto';

@Controller('purchases')
export class PurchaseController {
  constructor(private purchaseService: PurchaseService) {}

  @Post()
  create(@Body() dto: CreatePurchaseDto, @Req() req) {
    return this.purchaseService.create(dto, req.user.storeId);
  }
}
