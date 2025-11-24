import { Module } from '@nestjs/common';
import { BusinessTypeController } from './business-type.controller';
import { BusinessTypeService } from './business-type.service';

@Module({
  controllers: [BusinessTypeController],
  providers: [BusinessTypeService]
})
export class BusinessTypeModule {}
