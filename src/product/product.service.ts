import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  async create(
    dto: CreateProductDto,
    imageUrl: string | undefined,
    storeId: string,
  ) {
    return this.prisma.product.create({
      data: {
        ...dto,
        imageUrl,
        storeId, // ambil dari token
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
        include: { category: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.count({
        where: { storeId },
      }),
    ]);

    return {
      data,
      page,
      size,
      total,
      totalPages: Math.ceil(total / size),
      hasNext: page * size < total,
      hasPrev: page > 1,
    };
  }

  async findAll(storeId: string) {
    return this.prisma.product.findMany({
      where: { storeId },
      include: { category: true },
    });
  }

  async findOne(id: string, storeId: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });

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
    const product = await this.findOne(id, storeId); // sudah cek storeId juga

    return this.prisma.product.update({
      where: { id },
      data: {
        ...dto,
        ...(imageUrl && { imageUrl }),
      },
    });
  }

  async remove(id: string, storeId: string) {
    await this.findOne(id, storeId); // cek akses

    return this.prisma.product.delete({
      where: { id },
    });
  }
}
