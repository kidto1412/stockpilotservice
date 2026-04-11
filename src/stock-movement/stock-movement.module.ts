import { Module } from '@nestjs/common';
import { StockMovementController } from './stock-movement.controller';
import { StockMovementService } from './stock-movement.service';

@Module({
  controllers: [StockMovementController],
  providers: [StockMovementService],
})
export class StockMovementModule {}
