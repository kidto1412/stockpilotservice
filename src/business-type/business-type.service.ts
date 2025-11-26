import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { baseResponse } from 'src/utils/response.util';

@Injectable()
export class BusinessTypeService {
  constructor(private prisma: PrismaService) {}
  async getBusinessType() {
    const province = await this.prisma.businessType.findMany();
    return baseResponse(province);
  }
}
