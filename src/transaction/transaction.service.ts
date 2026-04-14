import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateTransactionDto,
  SalesChartGroupBy,
  SalesChartQueryDto,
  SalesStatusFilter,
  SalesTransactionQueryDto,
  SalesSummaryQueryDto,
  TransactionQueryDto,
} from './dto/transaction.dto';
import { paginateResponse } from 'src/utils/response.util';

@Injectable()
export class TransactionService {
  constructor(private prisma: PrismaService) {}

  private buildSalesWhere(
    query: {
      startDate?: string;
      endDate?: string;
      paymentMethod?: Prisma.TransactionWhereInput['paymentMethod'];
      status?: SalesStatusFilter;
    },
    storeId: string,
    options?: {
      defaultStatus?: Prisma.TransactionWhereInput['status'];
    },
  ): Prisma.TransactionWhereInput {
    const where: Prisma.TransactionWhereInput = {
      storeId,
    };

    if (query.status && query.status !== SalesStatusFilter.ALL) {
      where.status = query.status;
    } else if (options?.defaultStatus) {
      where.status = options.defaultStatus;
    }

    if (query.paymentMethod) {
      where.paymentMethod = query.paymentMethod;
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

  private getSalesPeriodLabel(date: Date, groupBy: SalesChartGroupBy) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    if (groupBy === SalesChartGroupBy.YEARLY) {
      return `${year}`;
    }

    if (groupBy === SalesChartGroupBy.MONTHLY) {
      return `${year}-${month}`;
    }

    return `${year}-${month}-${day}`;
  }

  private getDiscountAmount(
    unitPrice: number,
    quantity: number,
    discount?: { valueType: 'PERCENT' | 'AMOUNT'; value: number } | null,
  ) {
    if (!discount) return 0;

    const lineTotal = unitPrice * quantity;

    if (discount.valueType === 'PERCENT') {
      const amount = (lineTotal * discount.value) / 100;
      return Math.min(lineTotal, Math.max(0, amount));
    }

    return Math.min(lineTotal, Math.max(0, discount.value));
  }

  private async generateInvoiceNumber(tx: PrismaService) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `TRX-${Date.now()}-${Math.floor(Math.random() * 1000)
        .toString()
        .padStart(3, '0')}`;

      const existing = await tx.transaction.findUnique({
        where: { invoiceNumber: candidate },
        select: { id: true },
      });

      if (!existing) {
        return candidate;
      }
    }

    throw new BadRequestException('Gagal membuat nomor invoice unik');
  }

  async create(dto: CreateTransactionDto, storeId: string, user: any) {
    const cashierId = user?.sub;

    if (!cashierId) {
      throw new UnauthorizedException('Cashier tidak ditemukan dari token');
    }

    return this.prisma.$transaction(async (tx) => {
      const cashier = await tx.user.findUnique({
        where: { id: cashierId },
        select: { id: true },
      });

      if (!cashier) {
        throw new UnauthorizedException('User cashier tidak valid');
      }

      const productIds = dto.items.map((item) => item.productId);
      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          storeId,
        },
        include: {
          productDiscounts: {
            include: {
              discount: {
                select: {
                  id: true,
                  valueType: true,
                  value: true,
                },
              },
            },
          },
        },
      });

      if (products.length !== productIds.length) {
        throw new NotFoundException(
          'Sebagian produk tidak ditemukan pada store ini',
        );
      }

      const productMap = new Map(
        products.map((product) => [product.id, product]),
      );

      let totalAmount = 0;
      const itemCalculations: {
        productId: string;
        quantity: number;
        price: number;
        subtotal: number;
        discountId?: string;
      }[] = [];

      for (const item of dto.items) {
        const product = productMap.get(item.productId);

        if (!product) {
          throw new NotFoundException(
            `Produk ${item.productId} tidak ditemukan`,
          );
        }

        if (item.quantity > product.stock) {
          throw new BadRequestException(
            `Stok tidak cukup untuk produk ${product.name}. Stok tersedia ${product.stock}`,
          );
        }

        const price = item.price ?? product.price;

        let appliedDiscount: {
          id: string;
          valueType: 'PERCENT' | 'AMOUNT';
          value: number;
        } | null = null;

        if (item.discountId) {
          const selected = product.productDiscounts.find(
            (relation) => relation.discountId === item.discountId,
          );

          if (selected?.discount) {
            appliedDiscount = selected.discount;
          }
        }

        if (!appliedDiscount && product.productDiscounts.length) {
          let bestDiscount = product.productDiscounts[0].discount;
          let bestAmount = this.getDiscountAmount(
            price,
            item.quantity,
            bestDiscount,
          );

          for (const relation of product.productDiscounts.slice(1)) {
            const amount = this.getDiscountAmount(
              price,
              item.quantity,
              relation.discount,
            );

            if (amount > bestAmount) {
              bestAmount = amount;
              bestDiscount = relation.discount;
            }
          }

          appliedDiscount = bestDiscount;
        }

        const discountAmount = this.getDiscountAmount(
          price,
          item.quantity,
          appliedDiscount,
        );
        const subtotal = price * item.quantity - discountAmount;

        totalAmount += subtotal;
        itemCalculations.push({
          productId: item.productId,
          quantity: item.quantity,
          price,
          subtotal,
          discountId: appliedDiscount?.id,
        });
      }

      if (dto.customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: dto.customerId },
          select: { id: true, storeId: true },
        });

        if (!customer) {
          throw new NotFoundException('Customer tidak ditemukan');
        }

        if (customer.storeId !== storeId) {
          throw new ForbiddenException('Customer bukan milik store ini');
        }
      }

      if (dto.transactionDiscountId) {
        const transactionDiscount = await tx.discount.findUnique({
          where: { id: dto.transactionDiscountId },
          select: { id: true, storeId: true },
        });

        if (!transactionDiscount) {
          throw new NotFoundException('Diskon transaksi tidak ditemukan');
        }

        if (transactionDiscount.storeId !== storeId) {
          throw new ForbiddenException(
            'Diskon transaksi bukan milik store ini',
          );
        }
      }

      for (const item of dto.items) {
        if (!item.discountId) {
          continue;
        }

        const itemDiscount = await tx.discount.findUnique({
          where: { id: item.discountId },
          select: { id: true, storeId: true },
        });

        if (!itemDiscount) {
          throw new NotFoundException(
            `Diskon item ${item.discountId} tidak ditemukan`,
          );
        }

        if (itemDiscount.storeId !== storeId) {
          throw new ForbiddenException('Diskon item bukan milik store ini');
        }
      }

      const discount = dto.discount ?? 0;
      const grandTotal = totalAmount - discount;

      if (grandTotal < 0) {
        throw new BadRequestException('Grand total tidak boleh negatif');
      }

      if (dto.paidAmount <= 0) {
        throw new BadRequestException('Jumlah bayar harus lebih dari 0');
      }

      const paymentDelta = dto.paidAmount - grandTotal;
      const changeAmount = paymentDelta > 0 ? paymentDelta : 0;
      const remainingDebt = paymentDelta < 0 ? Math.abs(paymentDelta) : 0;

      if (remainingDebt > 0 && !dto.customerId) {
        throw new BadRequestException(
          'Transaksi hutang wajib memilih customer',
        );
      }

      const invoiceNumber = await this.generateInvoiceNumber(tx as any);

      const transaction = await tx.transaction.create({
        data: {
          invoiceNumber,
          storeId,
          cashierId,
          customerId: dto.customerId,
          paymentMethod: dto.paymentMethod,
          totalAmount,
          discount,
          tax: 0,
          grandTotal,
          paidAmount: dto.paidAmount,
          changeAmount,
          transactionDiscountId: dto.transactionDiscountId,
          transactionItems: {
            create: itemCalculations,
          },
        },
        include: {
          transactionItems: true,
        },
      });

      for (const item of dto.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: {
              decrement: item.quantity,
            },
          },
        });

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            storeId,
            type: 'OUT',
            source: 'SALE',
            quantity: item.quantity,
            referenceId: transaction.id,
          },
        });
      }

      if (remainingDebt > 0) {
        await tx.receivable.create({
          data: {
            storeId,
            customerId: dto.customerId,
            transactionId: transaction.id,
            totalAmount: grandTotal,
            paidAmount: dto.paidAmount,
            remaining: remainingDebt,
            status: 'PARTIAL',
          },
        });
      }

      const savedTransaction = await tx.transaction.findUnique({
        where: { id: transaction.id },
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
          transactionItems: {
            include: {
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
      });

      return {
        ...savedTransaction,
        paymentNotification:
          remainingDebt > 0
            ? `Pembayaran kurang. Masuk hutang sebesar ${remainingDebt}`
            : changeAmount > 0
              ? `Ada pengembalian sebesar ${changeAmount}`
              : 'Pembayaran pas',
      };
    });
  }

  async findAll(query: TransactionQueryDto, storeId: string) {
    const page = Math.max(1, Number(query.page || 1));
    const size = Math.max(1, Number(query.size || 10));
    const skip = (page - 1) * size;

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { storeId },
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
          transactionItems: {
            select: {
              id: true,
              productId: true,
              quantity: true,
              price: true,
              subtotal: true,
            },
          },
        },
      }),
      this.prisma.transaction.count({
        where: { storeId },
      }),
    ]);

    return paginateResponse(data, page, size, total);
  }

  async findSalesPagination(query: SalesTransactionQueryDto, storeId: string) {
    const page = Math.max(1, Number(query.page || 1));
    const requestedSize =
      query.size !== undefined ? Math.max(1, Number(query.size)) : undefined;
    const skip = requestedSize ? (page - 1) * requestedSize : undefined;

    const where = this.buildSalesWhere(query, storeId, {
      defaultStatus: 'COMPLETED',
    });

    const [data, total, summaryItems] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        ...(skip !== undefined ? { skip } : {}),
        ...(requestedSize !== undefined ? { take: requestedSize } : {}),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          invoiceNumber: true,
          createdAt: true,
          status: true,
          paymentMethod: true,
          discount: true,
          changeAmount: true,
          isSynced: true,
          paidAmount: true,
          grandTotal: true,
          cashier: {
            select: {
              fullName: true,
              username: true,
            },
          },
          transactionItems: {
            select: {
              id: true,
              quantity: true,
              price: true,
              subtotal: true,
              discount: {
                select: {
                  id: true,
                  name: true,
                  valueType: true,
                  value: true,
                },
              },
              product: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                  cost: true,
                  category: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transactionItem.findMany({
        where: { transaction: where },
        select: {
          quantity: true,
          subtotal: true,
          price: true,
          product: {
            select: {
              cost: true,
            },
          },
        },
      }),
    ]);

    const effectivePage = requestedSize !== undefined ? page : 1;
    const effectiveSize = requestedSize ?? (total > 0 ? total : 1);

    const content = data.map((trx) => {
      const items = trx.transactionItems.map((item) => {
        const originalUnitPrice = item.product.price;
        const soldUnitPrice = item.price;
        const quantity = item.quantity;
        const unitCost = item.product.cost;
        const totalCost = unitCost * quantity;
        const soldLineTotal = soldUnitPrice * quantity;

        return {
          itemId: item.id,
          productId: item.product.id,
          productName: item.product.name,
          categoryId: item.product.category?.id ?? null,
          categoryName: item.product.category?.name ?? null,
          quantity,
          unitCost,
          originalUnitPrice,
          soldUnitPrice,
          originalLineTotal: originalUnitPrice * quantity,
          soldLineTotal,
          totalCost,
          profit: soldLineTotal - totalCost,
          subtotal: item.subtotal,
          discount: item.discount
            ? {
                id: item.discount.id,
                name: item.discount.name,
                valueType: item.discount.valueType,
                value: item.discount.value,
              }
            : null,
        };
      });

      return {
        id: trx.id,
        invoiceNumber: trx.invoiceNumber,
        salesDate: trx.createdAt,
        status: trx.status,
        paymentMethod: trx.paymentMethod,
        cashierName: trx.cashier?.fullName ?? trx.cashier?.username ?? null,
        transactionDiscount: trx.discount ?? 0,
        changeAmount: trx.changeAmount,
        isSynced: trx.isSynced,
        paidAmount: trx.paidAmount,
        grandTotal: trx.grandTotal,
        items,
      };
    });

    const summary = summaryItems.reduce(
      (acc, item) => {
        acc.totalQuantity += item.quantity;
        acc.totalRevenue += item.price * item.quantity;
        const itemCost = item.product.cost * item.quantity;
        acc.totalCost += itemCost;
        const itemProfit = item.price * item.quantity - itemCost;
        if (itemProfit < 0) {
          acc.totalLoss += Math.abs(itemProfit);
        }
        return acc;
      },
      {
        totalQuantity: 0,
        totalRevenue: 0,
        totalCost: 0,
        totalProfit: 0,
        totalLoss: 0,
      },
    );

    summary.totalProfit = summary.totalRevenue - summary.totalCost;

    const pagination = paginateResponse(
      content,
      effectivePage,
      effectiveSize,
      total,
    );

    return {
      ...pagination,
      summary,
    };
  }

  async getSalesProfitLossChart(query: SalesChartQueryDto, storeId: string) {
    const where = this.buildSalesWhere(query, storeId);
    const groupBy = query.groupBy || SalesChartGroupBy.DAILY;

    const items = await this.prisma.transactionItem.findMany({
      where: {
        transaction: where,
      },
      select: {
        quantity: true,
        price: true,
        transaction: {
          select: {
            createdAt: true,
          },
        },
        product: {
          select: {
            cost: true,
          },
        },
      },
    });

    const grouped = new Map<
      string,
      {
        period: string;
        totalRevenue: number;
        totalCost: number;
        totalProfit: number;
        totalLoss: number;
      }
    >();

    for (const item of items) {
      const period = this.getSalesPeriodLabel(
        item.transaction.createdAt,
        groupBy,
      );
      const revenue = item.price * item.quantity;
      const cost = item.product.cost * item.quantity;
      const profit = revenue - cost;

      const current = grouped.get(period) || {
        period,
        totalRevenue: 0,
        totalCost: 0,
        totalProfit: 0,
        totalLoss: 0,
      };

      current.totalRevenue += revenue;
      current.totalCost += cost;
      current.totalProfit += profit;
      if (profit < 0) {
        current.totalLoss += Math.abs(profit);
      }

      grouped.set(period, current);
    }

    const content = Array.from(grouped.values()).sort((a, b) =>
      a.period.localeCompare(b.period),
    );

    const summary = content.reduce(
      (acc, item) => {
        acc.totalRevenue += item.totalRevenue;
        acc.totalCost += item.totalCost;
        acc.totalProfit += item.totalProfit;
        acc.totalLoss += item.totalLoss;
        return acc;
      },
      {
        totalRevenue: 0,
        totalCost: 0,
        totalProfit: 0,
        totalLoss: 0,
      },
    );

    return {
      groupBy,
      content,
      summary,
    };
  }

  async getSalesSummary(query: SalesSummaryQueryDto, storeId: string) {
    const where: Prisma.TransactionWhereInput = {
      storeId,
      status: 'COMPLETED',
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

    const [transactionItems, transactions] = await Promise.all([
      this.prisma.transactionItem.findMany({
        where: {
          transaction: where,
        },
        select: {
          quantity: true,
          subtotal: true,
          product: {
            select: {
              id: true,
              name: true,
              barcode: true,
              cost: true,
            },
          },
        },
      }),
      this.prisma.transaction.findMany({
        where,
        select: {
          grandTotal: true,
        },
      }),
    ]);

    const soldProductMap = new Map<
      string,
      {
        productId: string;
        productName: string;
        barcode: string | null;
        totalQuantity: number;
        totalRevenue: number;
        totalCost: number;
      }
    >();

    for (const item of transactionItems) {
      const product = item.product;
      const current = soldProductMap.get(product.id) || {
        productId: product.id,
        productName: product.name,
        barcode: product.barcode,
        totalQuantity: 0,
        totalRevenue: 0,
        totalCost: 0,
      };

      current.totalQuantity += item.quantity;
      current.totalRevenue += item.subtotal || 0;
      current.totalCost += product.cost * item.quantity;

      soldProductMap.set(product.id, current);
    }

    const soldProducts = Array.from(soldProductMap.values())
      .map((item) => ({
        ...item,
        totalProfit: item.totalRevenue - item.totalCost,
      }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity);

    const totalSalesAmount = transactions.reduce(
      (acc, item) => acc + item.grandTotal,
      0,
    );

    const totalCost = soldProducts.reduce(
      (acc, item) => acc + item.totalCost,
      0,
    );

    const totalProfit = totalSalesAmount - totalCost;

    const totalSoldQuantity = soldProducts.reduce(
      (acc, item) => acc + item.totalQuantity,
      0,
    );

    return {
      content: soldProducts,
      summary: {
        totalSalesAmount,
        totalCost,
        totalProfit,
        totalSoldProducts: soldProducts.length,
        totalSoldQuantity,
      },
      totalSalesAmount,
      totalCost,
      totalProfit,
      soldProducts,
    };
  }

  async scanSalesProduct(
    barcode: string,
    storeId: string,
    currentQuantity?: number,
  ) {
    const normalizedBarcode = barcode?.trim();

    if (!normalizedBarcode) {
      throw new BadRequestException('Barcode wajib diisi');
    }

    if (
      currentQuantity !== undefined &&
      (!Number.isFinite(currentQuantity) || currentQuantity < 0)
    ) {
      throw new BadRequestException('currentQuantity tidak valid');
    }

    const product = await this.prisma.product.findFirst({
      where: {
        storeId,
        barcode: normalizedBarcode,
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        productDiscounts: {
          include: {
            discount: {
              select: {
                id: true,
                name: true,
                valueType: true,
                value: true,
              },
            },
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(
        'Produk dengan barcode tersebut tidak ditemukan',
      );
    }

    let bestDiscount: {
      id: string;
      name: string;
      valueType: 'PERCENT' | 'AMOUNT';
      value: number;
    } | null = null;
    let bestDiscountAmount = 0;

    for (const relation of product.productDiscounts) {
      const discount = relation.discount;
      const amount = this.getDiscountAmount(product.price, 1, discount);

      if (amount > bestDiscountAmount) {
        bestDiscount = discount;
        bestDiscountAmount = amount;
      }
    }

    const quantity =
      currentQuantity !== undefined ? Math.floor(currentQuantity) + 1 : 1;

    return {
      productId: product.id,
      quantity,
      price: product.price,
      discountId: bestDiscount?.id,
    };
  }

  async findOne(id: string, storeId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
          },
        },
        cashier: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
        transactionItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                barcode: true,
              },
            },
            discount: {
              select: {
                id: true,
                name: true,
                valueType: true,
                value: true,
              },
            },
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaksi tidak ditemukan');
    }

    if (transaction.storeId !== storeId) {
      throw new ForbiddenException('Transaksi bukan milik store ini');
    }

    return transaction;
  }
}
