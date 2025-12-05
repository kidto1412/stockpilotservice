import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateCategoryDTO } from './dto/category.dto';
import { baseResponse, paginateResponse } from 'src/utils/response.util';

@Injectable()
export class CategoryService {
  constructor(private prisma: PrismaService) {}

  async findAll(storeId: string) {
    const category = this.prisma.category.findMany({
      where: { storeId },
    });
    return baseResponse(category);
  }

  async getPagination(page: number, size: number, storeId: string) {
    const skip = (page - 1) * size;

    const [data, total] = await Promise.all([
      this.prisma.category.findMany({
        where: { storeId },
        skip,
        take: size,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.category.count({
        where: { storeId },
      }),
    ]);

    return paginateResponse(data, page, size, total);
  }

  async create(data: CreateCategoryDTO, storeId: string) {
    return this.prisma.category.create({
      data: {
        ...data,

        storeId: storeId,
      },
    });
  }

  async update(id: string, data: CreateCategoryDTO) {
    return this.prisma.category.update({
      where: {
        id,
      },
      data: {
        ...data,
      },
    });
  }

  remove(id: string) {
    return this.prisma.category.delete({ where: { id } });
  }
}
