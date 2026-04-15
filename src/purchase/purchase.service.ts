import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePurchaseDto } from './dto/request-purchase.dto';

@Injectable()
export class PurchaseService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreatePurchaseDto, storeId: string) {
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({
        where: { id: dto.supplierId },
      });

      if (!supplier) {
        throw new NotFoundException('Supplier not found');
      }

      if (supplier.storeId !== storeId) {
        throw new ForbiddenException('Supplier not from this store');
      }

      const productIds = dto.items.map((item) => item.productId);
      const uniqueProductIds = Array.from(new Set(productIds));

      const products = await tx.product.findMany({
        where: {
          id: { in: uniqueProductIds },
          storeId,
        },
        select: {
          id: true,
          cost: true,
        },
      });

      if (products.length !== uniqueProductIds.length) {
        throw new NotFoundException(
          'Sebagian produk tidak ditemukan pada store ini',
        );
      }

      const productMap = new Map(
        products.map((product) => [product.id, product]),
      );

      const resolvedItems = dto.items.map((item) => {
        const product = productMap.get(item.productId);

        if (!product) {
          throw new NotFoundException('Product not found');
        }

        return {
          productId: item.productId,
          quantity: item.quantity,
          cost: product.cost,
        };
      });

      let totalAmount = 0;

      resolvedItems.forEach((item) => {
        totalAmount += item.cost * item.quantity;
      });

      const discount = dto.discount ?? 0;

      if (discount > totalAmount) {
        throw new BadRequestException(
          'Diskon pembelian tidak boleh lebih besar dari total pembelian',
        );
      }

      const netTotalAmount = totalAmount - discount;

      const paidAmount = dto.paidAmount ?? dto.amount ?? 0;

      if (paidAmount > netTotalAmount) {
        throw new BadRequestException(
          'paidAmount pembelian tidak boleh lebih besar dari total pembelian',
        );
      }

      const remaining = netTotalAmount - paidAmount;
      const payableStatus =
        remaining <= 0 ? 'PAID' : paidAmount <= 0 ? 'UNPAID' : 'PARTIAL';

      const purchase = await tx.purchase.create({
        data: {
          storeId,
          supplierId: dto.supplierId,
          invoiceNumber: dto.invoiceNumber,
          note: dto.note,
          totalAmount: netTotalAmount,
        },
      });

      for (const item of resolvedItems) {
        await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            productId: item.productId,
            quantity: item.quantity,
            cost: item.cost,
          },
        });

        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: {
              increment: item.quantity,
            },
          },
        });

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            storeId,
            type: 'IN',
            quantity: item.quantity,
            referenceId: purchase.id,
          },
        });
      }

      await tx.payable.create({
        data: {
          storeId,
          supplierId: dto.supplierId,
          purchaseId: purchase.id,
          totalAmount: netTotalAmount,
          paidAmount,
          remaining,
          status: payableStatus,
          dueDate: dto.dueDate,
        },
      });

      return purchase;
    });
  }
}
