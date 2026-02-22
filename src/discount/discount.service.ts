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
}
