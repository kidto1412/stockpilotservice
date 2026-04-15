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
    const firstDiscount = productDiscounts?.[0]?.discount;

    return {
      ...rest,
      discount: firstDiscount
        ? {
            id: firstDiscount.id,
            name: firstDiscount.name,
            valueType: firstDiscount.valueType,
            value: firstDiscount.value,
            description: firstDiscount.description,
          }
        : null,
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

  private async ensureDiscountBelongsToStore(
    discountId: string | undefined,
    storeId: string,
  ) {
    if (!discountId) return;

    const discount = await this.prisma.discount.findFirst({
      where: {
        id: discountId,
        storeId,
      },
      select: { id: true },
    });

    if (!discount) {
      throw new BadRequestException(
        'discountId tidak ditemukan pada store ini',
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

  private async resolveProductDiscountId(
    tx: any,
    discountId: string | undefined,
    discount: ProductInlineDiscountDto | undefined,
    storeId: string,
  ) {
    const discountIdFromInline = discount?.discountId;

    if (
      discountId &&
      discountIdFromInline &&
      discountId !== discountIdFromInline
    ) {
      throw new BadRequestException(
        'Gunakan salah satu discountId saja (root discountId atau discount.discountId)',
      );
    }

    const resolvedExistingDiscountId = discountId ?? discountIdFromInline;
    if (resolvedExistingDiscountId) {
      const existing = await tx.discount.findUnique({
        where: { id: resolvedExistingDiscountId },
        select: { id: true, storeId: true },
      });

      if (!existing) {
        throw new BadRequestException('Diskon tidak ditemukan');
      }

      if (existing.storeId !== storeId) {
        throw new BadRequestException('Diskon bukan milik store ini');
      }

      return existing.id;
    }

    if (!discount) {
      return undefined;
    }

    if (!this.hasInlineDiscountData(discount)) {
      throw new BadRequestException(
        'Diskon inline harus memiliki data name/valueType/value',
      );
    }

    if (!discount.name || !discount.valueType || discount.value === undefined) {
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

    return created.id;
  }

  async create(
    dto: CreateProductDto,
    imageUrl: string | undefined,
    storeId: string,
  ) {
    const {
      discountId,
      discount,
      barcode: barcodeInput,
      ...productData
    } = dto as any;

    const barcode =
      (await this.resolveBarcode(barcodeInput, storeId)) ||
      (await generateBarcode(this.prisma, storeId));

    await this.ensureDiscountBelongsToStore(discountId, storeId);

    return this.prisma.$transaction(async (tx) => {
      const resolvedDiscountId = await this.resolveProductDiscountId(
        tx,
        discountId,
        discount,
        storeId,
      );

      const product = await tx.product.create({
        data: {
          ...productData,
          barcode,
          imageUrl,
          storeId,
          productDiscounts: resolvedDiscountId
            ? {
                create: {
                  discountId: resolvedDiscountId,
                },
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

    const transformedData = data.map((product) =>
      this.transformProductResponse(product),
    );
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
      discountId,
      discount,
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
      const resolvedDiscountId = await this.resolveProductDiscountId(
        tx,
        discountId,
        discount,
        storeId,
      );

      if (discountId !== undefined || discount !== undefined) {
        await tx.productDiscount.deleteMany({
          where: { productId: id },
        });

        if (resolvedDiscountId) {
          await tx.productDiscount.create({
            data: {
              productId: id,
              discountId: resolvedDiscountId,
            },
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
