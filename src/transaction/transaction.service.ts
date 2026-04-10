import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateTransactionDto,
  TransactionQueryDto,
} from './dto/transaction.dto';
import { paginateResponse } from 'src/utils/response.util';

@Injectable()
export class TransactionService {
  constructor(private prisma: PrismaService) {}

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
        totalAmount += price * item.quantity;
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
      const tax = dto.tax ?? 0;
      const grandTotal = totalAmount - discount + tax;

      if (grandTotal < 0) {
        throw new BadRequestException('Grand total tidak boleh negatif');
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
          tax,
          grandTotal,
          transactionDiscountId: dto.transactionDiscountId,
          transactionItems: {
            create: dto.items.map((item) => {
              const product = productMap.get(item.productId);
              const price = item.price ?? product.price;

              return {
                productId: item.productId,
                quantity: item.quantity,
                price,
                subtotal: price * item.quantity,
                discountId: item.discountId,
              };
            }),
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

      return tx.transaction.findUnique({
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
