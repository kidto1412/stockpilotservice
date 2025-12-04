import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class StaffService {
  constructor(private prisma: PrismaService) {}
  private SALT_ROUNDS = 10; // rekomendasi 10-12
}
