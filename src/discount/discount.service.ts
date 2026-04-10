import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateDiscountDto, UpdateDiscountDto } from './dto/dicount.dto';
import { paginateResponse } from 'src/utils/response.util';

@Injectable()
export class DiscountService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateDiscountDto, storeId: string) {
    return this.prisma.discount.create({
      data: {
        ...dto,
        storeId,
      },
    });
  }

  async findAll(storeId: string) {
    return this.prisma.discount.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, storeId: string) {
    const discount = await this.prisma.discount.findUnique({
      where: { id },
    });

    if (!discount) throw new NotFoundException('Discount not found');
    if (discount.storeId !== storeId)
      throw new ForbiddenException('Unauthorized');

    return discount;
  }

  async update(id: string, dto: UpdateDiscountDto, storeId: string) {
    await this.findOne(id, storeId);

    return this.prisma.discount.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, storeId: string) {
    await this.findOne(id, storeId);

    return this.prisma.discount.delete({
      where: { id },
    });
  }
  async getPagination(page: number, size: number, storeId: string) {
    const skip = (page - 1) * size;

    const [data, total] = await Promise.all([
      this.prisma.discount.findMany({
        where: { storeId },
        skip,
        take: size,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.discount.count({
        where: { storeId },
      }),
    ]);

    return paginateResponse(data, page, size, total);
  }

  async assignProducts(id: string, productIds: string[], storeId: string) {
    await this.findOne(id, storeId);

    if (productIds.length === 0) {
      await this.prisma.productDiscount.deleteMany({
        where: {
          discountId: id,
          product: { storeId },
        },
      });

      return this.findOneWithProducts(id, storeId);
    }

    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        storeId,
      },
      select: { id: true },
    });

    if (products.length !== productIds.length) {
      throw new BadRequestException(
        'Sebagian productId tidak ditemukan pada store ini',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.productDiscount.deleteMany({
        where: {
          discountId: id,
          product: { storeId },
        },
      });

      await tx.productDiscount.createMany({
        data: productIds.map((productId) => ({
          discountId: id,
          productId,
        })),
      });
    });

    return this.findOneWithProducts(id, storeId);
  }

  async findOneWithProducts(id: string, storeId: string) {
    const discount = await this.prisma.discount.findUnique({
      where: { id },
      include: {
        productRelations: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                stock: true,
              },
            },
          },
        },
      },
    });

    if (!discount) throw new NotFoundException('Discount not found');
    if (discount.storeId !== storeId)
      throw new ForbiddenException('Unauthorized');

    return discount;
  }
}
