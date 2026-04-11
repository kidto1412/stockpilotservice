import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { paginateResponse } from 'src/utils/response.util';
import { generateBarcode } from 'src/utils/generatebarcode';

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  private async resolveBarcode(
    barcodeInput: unknown,
    storeId: string,
  ): Promise<string | undefined> {
    if (barcodeInput === undefined) {
      return undefined;
    }

    if (barcodeInput === null) {
      return generateBarcode(this.prisma, storeId);
    }

    if (typeof barcodeInput === 'string') {
      const normalized = barcodeInput.trim();

      if (!normalized || normalized.toLowerCase() === 'null') {
        return generateBarcode(this.prisma, storeId);
      }

      return normalized;
    }

    return generateBarcode(this.prisma, storeId);
  }

  private async ensureDiscountsBelongToStore(
    discountIds: string[],
    storeId: string,
  ) {
    if (!discountIds || discountIds.length === 0) return;

    const discounts = await this.prisma.discount.findMany({
      where: {
        id: { in: discountIds },
        storeId,
      },
      select: { id: true },
    });

    if (discounts.length !== discountIds.length) {
      throw new BadRequestException(
        'Sebagian discountIds tidak ditemukan pada store ini',
      );
    }
  }

  async create(
    dto: CreateProductDto,
    imageUrl: string | undefined,
    storeId: string,
  ) {
    const { discountIds, barcode: barcodeInput, ...productData } = dto as any;

    const barcode =
      (await this.resolveBarcode(barcodeInput, storeId)) ||
      (await generateBarcode(this.prisma, storeId));

    await this.ensureDiscountsBelongToStore(discountIds, storeId);

    return this.prisma.product.create({
      data: {
        ...productData,
        barcode,
        imageUrl,
        storeId,
        productDiscounts: discountIds?.length
          ? {
              create: discountIds.map((discountId) => ({ discountId })),
            }
          : undefined,
      },
      include: {
        category: true,
        productDiscounts: {
          include: {
            discount: true,
          },
        },
      },
    });
  }
  async getPagination(page: number, size: number, storeId: string) {
    const skip = (page - 1) * size;

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where: { storeId },
        skip,
        take: size,
        include: {
          category: true,
          productDiscounts: {
            include: {
              discount: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.count({
        where: { storeId },
      }),
    ]);

    return paginateResponse(data, page, size, total);
  }

  async findAll(storeId: string) {
    return this.prisma.product.findMany({
      where: { storeId },
      include: {
        category: true,
        productDiscounts: {
          include: {
            discount: true,
          },
        },
      },
    });
  }

  async findOne(id: string, storeId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        productDiscounts: {
          include: {
            discount: true,
          },
        },
      },
    });

    if (!product) throw new NotFoundException('Product not found');

    // Cegah akses produk milik toko lain
    if (product.storeId !== storeId) {
      throw new ForbiddenException('Unauthorized access to this product');
    }

    return product;
  }

  async update(
    id: string,
    dto: UpdateProductDto,
    imageUrl: string | undefined,
    storeId: string,
  ) {
    const { discountIds, barcode: barcodeInput, ...productData } = dto as any;

    await this.findOne(id, storeId);
    await this.ensureDiscountsBelongToStore(discountIds, storeId);

    let barcodeData: { barcode?: string } = {};

    if (Object.prototype.hasOwnProperty.call(dto, 'barcode')) {
      barcodeData = {
        barcode: await this.resolveBarcode(barcodeInput, storeId),
      };
    }

    return this.prisma.$transaction(async (tx) => {
      if (discountIds) {
        await tx.productDiscount.deleteMany({
          where: { productId: id },
        });

        if (discountIds.length) {
          await tx.productDiscount.createMany({
            data: discountIds.map((discountId) => ({
              productId: id,
              discountId,
            })),
          });
        }
      }

      return tx.product.update({
        where: { id },
        data: {
          ...productData,
          ...barcodeData,
          ...(imageUrl && { imageUrl }),
        },
        include: {
          category: true,
          productDiscounts: {
            include: {
              discount: true,
            },
          },
        },
      });
    });
  }

  async remove(id: string, storeId: string) {
    await this.findOne(id, storeId); // cek akses

    return this.prisma.product.delete({
      where: { id },
    });
  }
}
