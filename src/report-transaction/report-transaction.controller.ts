import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { StoreId } from 'src/common/decorators/user.decorator';
import {
  ExportReportTransactionDto,
  GeneralProductReportQueryDto,
} from './dto/report-transaction.dto';
import { ReportTransactionService } from './report-transaction.service.js';

@Controller('report-transaction')
export class ReportTransactionController {
  private readonly logger = new Logger(ReportTransactionController.name);

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
    this.logger.debug(
      `exportReport query=${JSON.stringify(query)} storeId=${storeId}`,
    );

    try {
      const result = await this.service.exportReport(query, storeId);

      this.logger.debug(
        `exportReport result fileName=${result.fileName} mimeType=${result.mimeType} bufferSize=${result.buffer?.length ?? result.buffer?.byteLength ?? 'unknown'}`,
      );

      res.setHeader('Content-Type', result.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.fileName}"`,
      );

      res.send(result.buffer);
    } catch (error) {
      this.logger.error(
        'exportReport failed',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
