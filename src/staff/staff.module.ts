import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';

@Module({
  providers: [StaffModule],
  controllers: [StaffController],
})
export class StaffModule {}
