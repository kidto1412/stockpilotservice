import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateProductDto,
  ProductInlineDiscountDto,
  UpdateProductDto,
} from './dto/product.dto';
import { paginateResponse } from 'src/utils/response.util';
import { generateBarcode } from 'src/utils/generatebarcode';

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  private transformProductResponse(product: any) {
    const { productDiscounts, ...rest } = product;
    return {
      ...rest,
      discounts: productDiscounts?.map((pd: any) => ({
        id: pd.discount.id,
        name: pd.discount.name,
        valueType: pd.discount.valueType,
        value: pd.discount.value,
        description: pd.discount.description,
      })) || [],
    };
  }

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

  private hasInlineDiscountData(discount: ProductInlineDiscountDto) {
    return Boolean(
      discount.name ||
        discount.description ||
        discount.valueType ||
        discount.value !== undefined,
    );
  }

  private async resolveProductDiscountIds(
    tx: any,
    discountIds: string[] | undefined,
    discounts: ProductInlineDiscountDto[] | undefined,
    storeId: string,
  ) {
    const resolvedIds: string[] = [];

    if (discountIds?.length) {
      await this.ensureDiscountsBelongToStore(discountIds, storeId);
      resolvedIds.push(...discountIds);
    }

    if (discounts?.length) {
      for (const discount of discounts) {
        if (discount.discountId) {
          const existing = await tx.discount.findUnique({
            where: { id: discount.discountId },
            select: { id: true, storeId: true },
          });

          if (!existing) {
            throw new BadRequestException('Diskon tidak ditemukan');
          }

          if (existing.storeId !== storeId) {
            throw new BadRequestException('Diskon bukan milik store ini');
          }

          resolvedIds.push(existing.id);
          continue;
        }

        if (!this.hasInlineDiscountData(discount)) {
          throw new BadRequestException(
            'Diskon inline harus memiliki data name/valueType/value',
          );
        }

        if (
          !discount.name ||
          !discount.valueType ||
          discount.value === undefined
        ) {
          throw new BadRequestException(
            'Diskon inline harus memiliki name, valueType, dan value',
          );
        }

        const created = await tx.discount.create({
          data: {
            storeId,
            name: discount.name,
            description: discount.description,
            valueType: discount.valueType,
            value: discount.value,
          },
          select: { id: true },
        });

        resolvedIds.push(created.id);
      }
    }

    return Array.from(new Set(resolvedIds));
  }

  async create(
    dto: CreateProductDto,
    imageUrl: string | undefined,
    storeId: string,
  ) {
    const {
      discountIds,
      discounts,
      barcode: barcodeInput,
      ...productData
    } = dto as any;

    const barcode =
      (await this.resolveBarcode(barcodeInput, storeId)) ||
      (await generateBarcode(this.prisma, storeId));

    await this.ensureDiscountsBelongToStore(discountIds, storeId);

    return this.prisma.$transaction(async (tx) => {
      const resolvedDiscountIds = await this.resolveProductDiscountIds(
        tx,
        discountIds,
        discounts,
        storeId,
      );

      const product = await tx.product.create({
        data: {
          ...productData,
          barcode,
          imageUrl,
          storeId,
          productDiscounts: resolvedDiscountIds.length
            ? {
                create: resolvedDiscountIds.map((discountId) => ({
                  discountId,
                })),
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
      return this.transformProductResponse(product);
    });
  }
  async getPagination(
    page: number,
    size: number,
    storeId: string,
    categoryId?: string,
  ) {
    const skip = (page - 1) * size;
    const where = {
      storeId,
      ...(categoryId ? { categoryId } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
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
        where,
      }),
    ]);

    const transformedData = data.map((product) => this.transformProductResponse(product));
    return paginateResponse(transformedData, page, size, total);
  }

  async findAll(storeId: string, categoryId?: string) {
    const where = {
      storeId,
      ...(categoryId ? { categoryId } : {}),
    };

    const products = await this.prisma.product.findMany({
      where,
      include: {
        category: true,
        productDiscounts: {
          include: {
            discount: true,
          },
        },
      },
    });

    return products.map((product) => this.transformProductResponse(product));
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

    return this.transformProductResponse(product);
  }

  async update(
    id: string,
    dto: UpdateProductDto,
    imageUrl: string | undefined,
    storeId: string,
  ) {
    const {
      discountIds,
      discounts,
      barcode: barcodeInput,
      ...productData
    } = dto as any;

    await this.findOne(id, storeId);

    let barcodeData: { barcode?: string } = {};

    if (Object.prototype.hasOwnProperty.call(dto, 'barcode')) {
      barcodeData = {
        barcode: await this.resolveBarcode(barcodeInput, storeId),
      };
    }

    return this.prisma.$transaction(async (tx) => {
      const resolvedDiscountIds = await this.resolveProductDiscountIds(
        tx,
        discountIds,
        discounts,
        storeId,
      );

      if (discountIds !== undefined || discounts !== undefined) {
        await tx.productDiscount.deleteMany({
          where: { productId: id },
        });

        if (resolvedDiscountIds.length) {
          await tx.productDiscount.createMany({
            data: resolvedDiscountIds.map((discountId) => ({
              productId: id,
              discountId,
            })),
          });
        }
      }

      const product = await tx.product.update({
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
      return this.transformProductResponse(product);
    });
  }

  async remove(id: string, storeId: string) {
    await this.findOne(id, storeId); // cek akses

    return this.prisma.product.delete({
      where: { id },
    });
  }
}
