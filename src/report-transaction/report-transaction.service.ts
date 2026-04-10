import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginateResponse } from 'src/utils/response.util';
import {
  ExportReportTransactionDto,
  ReportExportFormat,
  ReportGroupBy,
  ReportTransactionQueryDto,
} from './dto/report-transaction.dto';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import PDFDocument = require('pdfkit');

interface GroupedReportItem {
  period: string;
  totalTransaction: number;
  totalAmount: number;
  totalDiscount: number;
  totalGrandTotal: number;
  totalPaidAmount: number;
  totalChangeAmount: number;
}

@Injectable()
export class ReportTransactionService {
  constructor(private prisma: PrismaService) {}

  private buildWhere(
    query: ReportTransactionQueryDto,
    storeId: string,
  ): Prisma.TransactionWhereInput {
    const where: Prisma.TransactionWhereInput = { storeId };

    if (query.paymentMethod) {
      where.paymentMethod = query.paymentMethod;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};

      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }

      if (query.endDate) {
        const endDate = new Date(query.endDate);
        endDate.setHours(23, 59, 59, 999);
        where.createdAt.lte = endDate;
      }
    }

    return where;
  }

  private getPeriodLabel(date: Date, groupBy: ReportGroupBy) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    if (groupBy === ReportGroupBy.YEARLY) {
      return `${year}`;
    }

    if (groupBy === ReportGroupBy.MONTHLY) {
      return `${year}-${month}`;
    }

    return `${year}-${month}-${day}`;
  }

  private async getGroupedSummary(
    query: ReportTransactionQueryDto,
    storeId: string,
    groupBy: ReportGroupBy,
  ) {
    const where = this.buildWhere(query, storeId);

    const rows = await this.prisma.transaction.findMany({
      where,
      select: {
        createdAt: true,
        totalAmount: true,
        discount: true,
        grandTotal: true,
        paidAmount: true,
        changeAmount: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const grouped = new Map<string, GroupedReportItem>();

    rows.forEach((item) => {
      const period = this.getPeriodLabel(item.createdAt, groupBy);

      if (!grouped.has(period)) {
        grouped.set(period, {
          period,
          totalTransaction: 0,
          totalAmount: 0,
          totalDiscount: 0,
          totalGrandTotal: 0,
          totalPaidAmount: 0,
          totalChangeAmount: 0,
        });
      }

      const current = grouped.get(period);

      current.totalTransaction += 1;
      current.totalAmount += item.totalAmount || 0;
      current.totalDiscount += item.discount || 0;
      current.totalGrandTotal += item.grandTotal || 0;
      current.totalPaidAmount += item.paidAmount || 0;
      current.totalChangeAmount += item.changeAmount || 0;
    });

    return Array.from(grouped.values()).sort((a, b) =>
      a.period.localeCompare(b.period),
    );
  }

  private async exportToExcel(
    data: GroupedReportItem[],
    groupBy: ReportGroupBy,
  ) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Report');

    worksheet.columns = [
      { header: 'Periode', key: 'period', width: 20 },
      { header: 'Total Transaksi', key: 'totalTransaction', width: 18 },
      { header: 'Total Amount', key: 'totalAmount', width: 18 },
      { header: 'Total Discount', key: 'totalDiscount', width: 18 },
      { header: 'Grand Total', key: 'totalGrandTotal', width: 20 },
      { header: 'Total Dibayar', key: 'totalPaidAmount', width: 18 },
      { header: 'Total Kembalian', key: 'totalChangeAmount', width: 18 },
    ];

    data.forEach((item) => {
      worksheet.addRow(item);
    });

    const totalRow = {
      period: 'TOTAL',
      totalTransaction: data.reduce(
        (acc, item) => acc + item.totalTransaction,
        0,
      ),
      totalAmount: data.reduce((acc, item) => acc + item.totalAmount, 0),
      totalDiscount: data.reduce((acc, item) => acc + item.totalDiscount, 0),
      totalGrandTotal: data.reduce(
        (acc, item) => acc + item.totalGrandTotal,
        0,
      ),
      totalPaidAmount: data.reduce(
        (acc, item) => acc + item.totalPaidAmount,
        0,
      ),
      totalChangeAmount: data.reduce(
        (acc, item) => acc + item.totalChangeAmount,
        0,
      ),
    };

    worksheet.addRow(totalRow);

    const buffer = await workbook.xlsx.writeBuffer();
    const fileSuffix = groupBy.toLowerCase();

    return {
      buffer: Buffer.from(buffer as ArrayBuffer),
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: `report-transaction-${fileSuffix}.xlsx`,
    };
  }

  private async exportToPdf(data: GroupedReportItem[], groupBy: ReportGroupBy) {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));

    const result = new Promise<Buffer>((resolve) => {
      doc.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
    });

    doc.fontSize(16).text('Laporan Transaksi', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Group By: ${groupBy}`);
    doc.moveDown();

    doc
      .fontSize(10)
      .text(
        'Periode | Total Trx | Total Amount | Discount | Grand Total | Dibayar | Kembalian',
      );
    doc.moveDown(0.5);

    data.forEach((item) => {
      doc.text(
        `${item.period} | ${item.totalTransaction} | ${item.totalAmount.toFixed(2)} | ${item.totalDiscount.toFixed(2)} | ${item.totalGrandTotal.toFixed(2)} | ${item.totalPaidAmount.toFixed(2)} | ${item.totalChangeAmount.toFixed(2)}`,
      );
    });

    const totals = {
      totalTransaction: data.reduce(
        (acc, item) => acc + item.totalTransaction,
        0,
      ),
      totalAmount: data.reduce((acc, item) => acc + item.totalAmount, 0),
      totalDiscount: data.reduce((acc, item) => acc + item.totalDiscount, 0),
      totalGrandTotal: data.reduce(
        (acc, item) => acc + item.totalGrandTotal,
        0,
      ),
      totalPaidAmount: data.reduce(
        (acc, item) => acc + item.totalPaidAmount,
        0,
      ),
      totalChangeAmount: data.reduce(
        (acc, item) => acc + item.totalChangeAmount,
        0,
      ),
    };

    doc.moveDown();
    doc.text(
      `TOTAL | ${totals.totalTransaction} | ${totals.totalAmount.toFixed(2)} | ${totals.totalDiscount.toFixed(2)} | ${totals.totalGrandTotal.toFixed(2)} | ${totals.totalPaidAmount.toFixed(2)} | ${totals.totalChangeAmount.toFixed(2)}`,
    );

    doc.end();

    const fileSuffix = groupBy.toLowerCase();
    const buffer = await result;

    return {
      buffer,
      mimeType: 'application/pdf',
      fileName: `report-transaction-${fileSuffix}.pdf`,
    };
  }

  async findAll(query: ReportTransactionQueryDto, storeId: string) {
    const page = Math.max(1, Number(query.page || 1));
    const size = Math.max(1, Number(query.size || 10));
    const skip = (page - 1) * size;
    const where = this.buildWhere(query, storeId);

    const [data, total, aggregate] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: size,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
          cashier: {
            select: {
              id: true,
              fullName: true,
              username: true,
            },
          },
          staff: {
            select: {
              id: true,
              fullName: true,
              username: true,
            },
          },
          transactionItems: {
            select: {
              id: true,
              productId: true,
              quantity: true,
              price: true,
              subtotal: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  barcode: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.aggregate({
        where,
        _sum: {
          totalAmount: true,
          discount: true,
          grandTotal: true,
          paidAmount: true,
          changeAmount: true,
        },
      }),
    ]);

    return {
      ...paginateResponse(data, page, size, total),
      summary: {
        totalAmount: aggregate._sum.totalAmount || 0,
        totalDiscount: aggregate._sum.discount || 0,
        totalGrandTotal: aggregate._sum.grandTotal || 0,
        totalPaidAmount: aggregate._sum.paidAmount || 0,
        totalChangeAmount: aggregate._sum.changeAmount || 0,
      },
    };
  }

  async exportReport(query: ExportReportTransactionDto, storeId: string) {
    const groupBy = query.groupBy || ReportGroupBy.DAILY;
    const format = query.format || ReportExportFormat.EXCEL;

    const groupedData = await this.getGroupedSummary(query, storeId, groupBy);

    if (format === ReportExportFormat.PDF) {
      return this.exportToPdf(groupedData, groupBy);
    }

    return this.exportToExcel(groupedData, groupBy);
  }
}
