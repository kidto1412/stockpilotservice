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

      let totalAmount = 0;

      dto.items.forEach((item) => {
        totalAmount += item.cost * item.quantity;
      });

      const discount = dto.discount ?? 0;

      if (discount > totalAmount) {
        throw new BadRequestException(
          'Diskon pembelian tidak boleh lebih besar dari total pembelian',
        );
      }

      const netTotalAmount = totalAmount - discount;

      if (dto.amount > netTotalAmount) {
        throw new BadRequestException(
          'Amount pembelian tidak boleh lebih besar dari total pembelian',
        );
      }

      const remaining = netTotalAmount - dto.amount;
      const payableStatus =
        remaining <= 0 ? 'PAID' : dto.amount <= 0 ? 'UNPAID' : 'PARTIAL';

      const purchase = await tx.purchase.create({
        data: {
          storeId,
          supplierId: dto.supplierId,
          invoiceNumber: dto.invoiceNumber,
          note: dto.note,
          totalAmount: netTotalAmount,
        },
      });

      for (const item of dto.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });

        if (!product) {
          throw new NotFoundException('Product not found');
        }

        if (product.storeId !== storeId) {
          throw new ForbiddenException('Product not from this store');
        }

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
          paidAmount: dto.amount,
          remaining,
          status: payableStatus,
          dueDate: dto.dueDate,
        },
      });

      return purchase;
    });
  }
}
