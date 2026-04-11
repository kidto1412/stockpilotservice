import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginateResponse } from 'src/utils/response.util';
import {
  CreateExpenseStockMovementDto,
  StockMovementDashboardGroupBy,
  StockMovementSource,
  StockMovementQueryDto,
} from './dto/stock-movement.dto';

type StockMovementSummary = {
  totalIn: number;
  totalOut: number;
  net: number;
};

@Injectable()
export class StockMovementService {
  constructor(private prisma: PrismaService) {}

  private getPeriodLabel(date: Date, groupBy: StockMovementDashboardGroupBy) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    if (groupBy === StockMovementDashboardGroupBy.YEARLY) {
      return `${year}`;
    }

    if (groupBy === StockMovementDashboardGroupBy.MONTHLY) {
      return `${year}-${month}`;
    }

    return `${year}-${month}-${day}`;
  }

  private buildSummary(
    movements: Array<{ type: StockMovementType; quantity: number }>,
  ): StockMovementSummary {
    return movements.reduce<StockMovementSummary>(
      (acc, movement) => {
        if (movement.type === StockMovementType.IN) {
          acc.totalIn += movement.quantity;
        }

        if (movement.type === StockMovementType.OUT) {
          acc.totalOut += movement.quantity;
        }

        acc.net = acc.totalIn - acc.totalOut;
        return acc;
      },
      { totalIn: 0, totalOut: 0, net: 0 },
    );
  }

  private buildWhere(
    query: StockMovementQueryDto,
    storeId: string,
  ): Prisma.StockMovementWhereInput {
    const where: Prisma.StockMovementWhereInput = { storeId };
    const productWhere: Prisma.ProductWhereInput = {};

    if (query.type) {
      where.type = query.type;
    }

    if (query.source) {
      where.source = query.source;
    }

    if (query.productId) {
      where.productId = query.productId;
    }

    if (query.categoryId) {
      productWhere.categoryId = query.categoryId;
    }

    if (Object.keys(productWhere).length > 0) {
      where.product = productWhere;
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

  private async enrichReference(
    movement: Prisma.StockMovementGetPayload<{
      include: {
        product: {
          select: {
            id: true;
            name: true;
            barcode: true;
            category: {
              select: {
                id: true;
                name: true;
              };
            };
          };
        };
        supplier: {
          select: {
            id: true;
            name: true;
          };
        };
      };
    }>,
  ) {
    let reference: any = null;

    if (
      movement.source === StockMovementSource.PURCHASE &&
      movement.referenceId
    ) {
      reference = await this.prisma.purchase.findUnique({
        where: { id: movement.referenceId },
        select: {
          id: true,
          invoiceNumber: true,
          supplierId: true,
          createdAt: true,
        },
      });
    }

    if (
      (movement.source === StockMovementSource.SALE ||
        movement.source === StockMovementSource.EXPENSE) &&
      movement.referenceId
    ) {
      reference = await this.prisma.transaction.findUnique({
        where: { id: movement.referenceId },
        select: {
          id: true,
          invoiceNumber: true,
          grandTotal: true,
          createdAt: true,
        },
      });
    }

    return {
      ...movement,
      reference,
    };
  }

  async history(query: StockMovementQueryDto, storeId: string) {
    const page = Math.max(1, Number(query.page || 1));
    const size = Math.max(1, Number(query.size || 10));
    const skip = (page - 1) * size;
    const where = this.buildWhere(query, storeId);

    const [data, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        skip,
        take: size,
        orderBy: { createdAt: 'desc' },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              barcode: true,
              category: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    const content = await Promise.all(
      data.map((movement) => this.enrichReference(movement)),
    );

    const summary = this.buildSummary(data);

    return {
      ...paginateResponse(content, page, size, total),
      summary,
    };
  }

  async historyByProduct(
    productId: string,
    query: StockMovementQueryDto,
    storeId: string,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        storeId: true,
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.storeId !== storeId) {
      throw new ForbiddenException('Product not from this store');
    }

    const page = Math.max(1, Number(query.page || 1));
    const size = Math.max(1, Number(query.size || 10));
    const skip = (page - 1) * size;
    const where = this.buildWhere({ ...query, productId }, storeId);

    const [data, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        skip,
        take: size,
        orderBy: { createdAt: 'desc' },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              barcode: true,
              category: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    const content = await Promise.all(
      data.map((movement) => this.enrichReference(movement)),
    );
    const summary = this.buildSummary(data);

    return {
      product,
      ...paginateResponse(content, page, size, total),
      summary,
    };
  }

  async dashboard(query: StockMovementQueryDto, storeId: string) {
    const groupBy = query.groupBy || StockMovementDashboardGroupBy.DAILY;
    const where = this.buildWhere(query, storeId);

    const movements = await this.prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      select: {
        createdAt: true,
        type: true,
        quantity: true,
      },
    });

    const grouped = new Map<
      string,
      {
        period: string;
        totalIn: number;
        totalOut: number;
        net: number;
        movementCount: number;
      }
    >();

    movements.forEach((movement) => {
      const period = this.getPeriodLabel(movement.createdAt, groupBy);

      if (!grouped.has(period)) {
        grouped.set(period, {
          period,
          totalIn: 0,
          totalOut: 0,
          net: 0,
          movementCount: 0,
        });
      }

      const current = grouped.get(period);
      current.movementCount += 1;

      if (movement.type === StockMovementType.IN) {
        current.totalIn += movement.quantity;
      }

      if (movement.type === StockMovementType.OUT) {
        current.totalOut += movement.quantity;
      }

      current.net = current.totalIn - current.totalOut;
    });

    const content = Array.from(grouped.values()).sort((a, b) =>
      a.period.localeCompare(b.period),
    );

    const summary = this.buildSummary(movements);

    return {
      groupBy,
      summary,
      content,
    };
  }

  async createExpenseOut(dto: CreateExpenseStockMovementDto, storeId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.storeId !== storeId) {
      throw new ForbiddenException('Product not from this store');
    }

    if (product.stock < dto.quantity) {
      throw new BadRequestException('Stok tidak cukup untuk pengeluaran');
    }

    return this.prisma.$transaction(async (tx) => {
      const movement = await tx.stockMovement.create({
        data: {
          productId: dto.productId,
          storeId,
          type: StockMovementType.OUT,
          source: 'EXPENSE',
          quantity: dto.quantity,
          note: dto.note,
        },
      });

      await tx.product.update({
        where: { id: dto.productId },
        data: {
          stock: {
            decrement: dto.quantity,
          },
        },
      });

      return movement;
    });
  }
}
