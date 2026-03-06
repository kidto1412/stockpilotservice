import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateSupplierDto,
  UpdateSupplierDto,
} from './dto/request-supplier.dto';
import { paginateResponse } from 'src/utils/response.util';

@Injectable()
export class SupplierService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSupplierDto, storeId: string) {
    return this.prisma.supplier.create({
      data: {
        ...dto,
        storeId,
      },
    });
  }

  async getPagination(page: number, size: number, storeId: string) {
    const skip = (page - 1) * size;

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where: { storeId },
        skip,
        take: size,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supplier.count({
        where: { storeId },
      }),
    ]);

    return paginateResponse(data, page, size, total);
  }

  async findAll(storeId: string) {
    return this.prisma.supplier.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, storeId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
    });

    if (!supplier) throw new NotFoundException('Supplier not found');

    if (supplier.storeId !== storeId) {
      throw new ForbiddenException('Unauthorized access to this supplier');
    }

    return supplier;
  }

  async update(id: string, dto: UpdateSupplierDto, storeId: string) {
    await this.findOne(id, storeId);

    return this.prisma.supplier.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, storeId: string) {
    await this.findOne(id, storeId);

    return this.prisma.supplier.delete({
      where: { id },
    });
  }
}
