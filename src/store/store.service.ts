import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateStoreDto, UpdateStoreDto } from './dto/store.dto';
import { baseResponse, paginateResponse } from 'src/utils/response.util';

@Injectable()
export class StoreService {
  constructor(private prisma: PrismaService) {}

  private async generateStoreCode(): Promise<string> {
    const lastStore = await this.prisma.store.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    let lastNumber = 0;
    if (lastStore?.code) {
      const match = lastStore.code.match(/(\d+)$/);
      if (match) lastNumber = parseInt(match[1], 10);
    }

    const newNumber = lastNumber + 1;
    return `STORE-${newNumber.toString().padStart(5, '0')}`;
  }

  async create(data: CreateStoreDto) {
    const code = await this.generateStoreCode();
    return this.prisma.store.create({
      data: { ...data, code },
    });
  }
  async findAll() {
    const stores = this.prisma.store.findMany();
    return baseResponse(stores);
  }
  async findOne(id: string) {
    const store = await this.prisma.store.findUnique({ where: { id } });
    if (!store) throw new NotFoundException('User not found');
    return store;
  }
  update(id: string, data: UpdateStoreDto) {
    return this.prisma.user.update({
      where: { id },
      data: { ...data },
    });
  }

  remove(id: string) {
    return this.prisma.store.delete({ where: { id } });
  }

  async getPagination(page: number, size: number) {
    const skip = (page - 1) * size;

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: size,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.store.count(),
    ]);

    return paginateResponse(data, page, size, total);
  }
}
