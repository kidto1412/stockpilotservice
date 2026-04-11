import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginateResponse } from 'src/utils/response.util';
import {
  ExportReportTransactionDto,
  GeneralProductReportQueryDto,
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

export interface GeneralProductReportItem {
  productId: string;
  productName: string;
  barcode: string | null;
  categoryId: string | null;
  categoryName: string | null;
  currentStock: number;
  cost: number;
  price: number;
  boughtQuantity: number;
  soldQuantity: number;
  boughtTotal: number;
  soldTotal: number;
  profit: number;
}

export interface GeneralProductReportSummary {
  totalBoughtQuantity: number;
  totalSoldQuantity: number;
  totalBoughtTotal: number;
  totalSoldTotal: number;
  totalProfit: number;
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

  private buildProductWhere(
    query: GeneralProductReportQueryDto,
    storeId: string,
  ): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = { storeId };

    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }

    return where;
  }

  private buildDateRange(query: GeneralProductReportQueryDto) {
    if (!query.startDate && !query.endDate) {
      return undefined;
    }

    const createdAt: Prisma.DateTimeFilter = {};

    if (query.startDate) {
      createdAt.gte = new Date(query.startDate);
    }

    if (query.endDate) {
      const endDate = new Date(query.endDate);
      endDate.setHours(23, 59, 59, 999);
      createdAt.lte = endDate;
    }

    return createdAt;
  }

  private async buildGeneralReportRows(
    query: GeneralProductReportQueryDto,
    storeId: string,
  ) {
    const page = Math.max(1, Number(query.page || 1));
    const size = Math.max(1, Number(query.size || 10));
    const skip = (page - 1) * size;
    const productWhere = this.buildProductWhere(query, storeId);
    const dateRange = this.buildDateRange(query);

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where: productWhere,
        skip,
        take: size,
        orderBy: { createdAt: 'desc' },
        include: {
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.product.count({ where: productWhere }),
    ]);

    const productIds = products.map((product) => product.id);

    const [purchaseItems, transactionItems] = await Promise.all([
      this.prisma.purchaseItem.findMany({
        where: {
          productId: { in: productIds },
          ...(dateRange
            ? {
                purchase: {
                  createdAt: dateRange,
                },
              }
            : {}),
        },
        select: {
          productId: true,
          quantity: true,
          cost: true,
        },
      }),
      this.prisma.transactionItem.findMany({
        where: {
          productId: { in: productIds },
          transaction: {
            status: 'COMPLETED',
            ...(dateRange
              ? {
                  createdAt: dateRange,
                }
              : {}),
          },
        },
        select: {
          productId: true,
          quantity: true,
          subtotal: true,
        },
      }),
    ]);

    const purchaseMap = new Map<
      string,
      { boughtQuantity: number; boughtTotal: number }
    >();

    for (const item of purchaseItems) {
      const current = purchaseMap.get(item.productId) || {
        boughtQuantity: 0,
        boughtTotal: 0,
      };

      current.boughtQuantity += item.quantity;
      current.boughtTotal += item.quantity * item.cost;

      purchaseMap.set(item.productId, current);
    }

    const salesMap = new Map<
      string,
      { soldQuantity: number; soldTotal: number }
    >();

    for (const item of transactionItems) {
      const current = salesMap.get(item.productId) || {
        soldQuantity: 0,
        soldTotal: 0,
      };

      current.soldQuantity += item.quantity;
      current.soldTotal += item.subtotal;

      salesMap.set(item.productId, current);
    }

    const content: GeneralProductReportItem[] = products.map((product) => {
      const purchased = purchaseMap.get(product.id) || {
        boughtQuantity: 0,
        boughtTotal: 0,
      };

      const sold = salesMap.get(product.id) || {
        soldQuantity: 0,
        soldTotal: 0,
      };

      return {
        productId: product.id,
        productName: product.name,
        barcode: product.barcode,
        categoryId: product.category?.id ?? null,
        categoryName: product.category?.name ?? null,
        currentStock: product.stock,
        cost: product.cost,
        price: product.price,
        boughtQuantity: purchased.boughtQuantity,
        soldQuantity: sold.soldQuantity,
        boughtTotal: purchased.boughtTotal,
        soldTotal: sold.soldTotal,
        profit: sold.soldTotal - purchased.boughtTotal,
      };
    });

    const summary: GeneralProductReportSummary = content.reduce(
      (acc, item) => {
        acc.totalBoughtQuantity += item.boughtQuantity;
        acc.totalSoldQuantity += item.soldQuantity;
        acc.totalBoughtTotal += item.boughtTotal;
        acc.totalSoldTotal += item.soldTotal;
        acc.totalProfit += item.profit;
        return acc;
      },
      {
        totalBoughtQuantity: 0,
        totalSoldQuantity: 0,
        totalBoughtTotal: 0,
        totalSoldTotal: 0,
        totalProfit: 0,
      },
    );

    return {
      content,
      page,
      size,
      total,
      totalPages: Math.ceil(total / size),
      hasNextPage: page * size < total,
      hasPrevPage: page > 1,
      summary,
    };
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

  async findAll(query: GeneralProductReportQueryDto, storeId: string) {
    return this.buildGeneralReportRows(query, storeId);
  }

  async exportReport(query: ExportReportTransactionDto, storeId: string) {
    const result = await this.buildGeneralReportRows(query, storeId);

    const format = query.format || ReportExportFormat.EXCEL;

    if (format === ReportExportFormat.PDF) {
      return this.exportGeneralToPdf(result.content);
    }

    return this.exportGeneralToExcel(result.content);
  }

  private async exportGeneralToExcel(data: GeneralProductReportItem[]) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Report General');

    worksheet.columns = [
      { header: 'Produk', key: 'productName', width: 24 },
      { header: 'Barcode', key: 'barcode', width: 18 },
      { header: 'Kategori', key: 'categoryName', width: 18 },
      { header: 'Stok Saat Ini', key: 'currentStock', width: 14 },
      { header: 'Harga Beli', key: 'cost', width: 14 },
      { header: 'Harga Jual', key: 'price', width: 14 },
      { header: 'Qty Beli', key: 'boughtQuantity', width: 12 },
      { header: 'Qty Jual', key: 'soldQuantity', width: 12 },
      { header: 'Total Beli', key: 'boughtTotal', width: 14 },
      { header: 'Total Jual', key: 'soldTotal', width: 14 },
      { header: 'Profit', key: 'profit', width: 14 },
    ];

    data.forEach((item) => worksheet.addRow(item));

    const totalRow = {
      productName: 'TOTAL',
      barcode: '',
      categoryName: '',
      currentStock: data.reduce((acc, item) => acc + item.currentStock, 0),
      cost: 0,
      price: 0,
      boughtQuantity: data.reduce((acc, item) => acc + item.boughtQuantity, 0),
      soldQuantity: data.reduce((acc, item) => acc + item.soldQuantity, 0),
      boughtTotal: data.reduce((acc, item) => acc + item.boughtTotal, 0),
      soldTotal: data.reduce((acc, item) => acc + item.soldTotal, 0),
      profit: data.reduce((acc, item) => acc + item.profit, 0),
    };

    worksheet.addRow(totalRow);

    const buffer = await workbook.xlsx.writeBuffer();

    return {
      buffer: Buffer.from(buffer as ArrayBuffer),
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: `report-general.xlsx`,
    };
  }

  private async exportGeneralToPdf(data: GeneralProductReportItem[]) {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));

    const result = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    doc.fontSize(16).text('Report General Produk', { align: 'center' });
    doc.moveDown();
    doc
      .fontSize(10)
      .text(
        'Produk | Stok | Harga Beli | Harga Jual | Qty Beli | Qty Jual | Total Beli | Total Jual | Profit',
      );
    doc.moveDown(0.5);

    data.forEach((item) => {
      doc.text(
        `${item.productName} | ${item.currentStock} | ${item.cost.toFixed(2)} | ${item.price.toFixed(2)} | ${item.boughtQuantity} | ${item.soldQuantity} | ${item.boughtTotal.toFixed(2)} | ${item.soldTotal.toFixed(2)} | ${item.profit.toFixed(2)}`,
      );
    });

    doc.end();

    return {
      buffer: await result,
      mimeType: 'application/pdf',
      fileName: 'report-general.pdf',
    };
  }
}
