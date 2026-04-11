import { Injectable } from '@nestjs/common';
import { Prisma, TransactionStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { DashboardSummaryQueryDto } from './dto/dashboard-summary.dto';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  private buildTransactionWhere(
    storeId: string,
    query: DashboardSummaryQueryDto,
  ): Prisma.TransactionWhereInput {
    const where: Prisma.TransactionWhereInput = {
      storeId,
      status: TransactionStatus.COMPLETED,
    };

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

  async getSummary(storeId: string, query: DashboardSummaryQueryDto) {
    const transactionWhere = this.buildTransactionWhere(storeId, query);

    const [
      totalProducts,
      totalCategories,
      transactionItems,
      transactionAggregate,
    ] = await Promise.all([
      this.prisma.product.count({ where: { storeId } }),
      this.prisma.category.count({ where: { storeId } }),
      this.prisma.transactionItem.findMany({
        where: {
          transaction: transactionWhere,
        },
        select: {
          quantity: true,
          subtotal: true,
          product: {
            select: {
              cost: true,
            },
          },
        },
      }),
      this.prisma.transaction.aggregate({
        where: transactionWhere,
        _sum: {
          grandTotal: true,
        },
      }),
    ]);

    const totalSold = transactionItems.reduce(
      (acc, item) => acc + item.quantity,
      0,
    );

    const totalCost = transactionItems.reduce(
      (acc, item) => acc + item.product.cost * item.quantity,
      0,
    );

    const totalRevenue = transactionAggregate._sum.grandTotal || 0;
    const totalProfit = totalRevenue - totalCost;

    return {
      totalProducts,
      totalCategories,
      totalSold,
      totalProfit,
    };
  }
}
