import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { StoreId } from 'src/common/decorators/user.decorator';
import {
  ExportReportTransactionDto,
  GeneralProductReportQueryDto,
} from './dto/report-transaction.dto';
import { ReportTransactionService } from './report-transaction.service.js';

@Controller('report-transaction')
export class ReportTransactionController {
  constructor(private readonly service: ReportTransactionService) {}

  @Get()
  findAll(
    @Query() query: GeneralProductReportQueryDto,
    @StoreId() storeId: string,
  ) {
    return this.service.findAll(query, storeId);
  }

  @Get('export')
  async exportReport(
    @Query() query: ExportReportTransactionDto,
    @StoreId() storeId: string,
    @Res() res: Response,
  ) {
    const result = await this.service.exportReport(query, storeId);

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.fileName}"`,
    );

    return res.send(result.buffer);
  }
}
