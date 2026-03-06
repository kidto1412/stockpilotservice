import { Module } from '@nestjs/common';
import { ProductController } from './product.controller';

@Module({
  providers: [ProductModule],
  controllers: [ProductController],
})
export class ProductModule {}
