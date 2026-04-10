import { Module } from '@nestjs/common';
import { ReportTransactionController } from './report-transaction.controller';
import { ReportTransactionService } from './report-transaction.service';

@Module({
  controllers: [ReportTransactionController],
  providers: [ReportTransactionService]
})
export class ReportTransactionModule {}
