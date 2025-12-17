// src/utils/barcode.util.ts
import { PrismaService } from 'src/prisma/prisma.service';

export async function generateBarcode(
  prisma: PrismaService,
  storeId: string,
): Promise<string> {
  const lastProduct = await prisma.product.findFirst({
    where: {
      storeId,
      barcode: { startsWith: 'BR' },
    },
    orderBy: { createdAt: 'desc' },
    select: { barcode: true },
  });

  const lastNumber = lastProduct?.barcode
    ? parseInt(lastProduct.barcode.replace('BR', ''), 10) + 1
    : 1;

  return `BR${lastNumber.toString().padStart(4, '0')}`;
}
