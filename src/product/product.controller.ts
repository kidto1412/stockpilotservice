import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  UseInterceptors,
  UploadedFile,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProductService } from './product.service';
import { UploadInterceptor } from 'src/common/interceptors/upload.interceptor';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { saveUploadedFile } from 'src/utils/upload-file.util';
import { StoreId } from 'src/common/decorators/user.decorator';

@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @UseInterceptors(UploadInterceptor('image'))
  async create(
    @Body() dto: CreateProductDto,
    @UploadedFile() file: Express.Multer.File,
    @StoreId() storeId: string,
  ) {
    let imageUrl: string | undefined;

    if (file) {
      const saved = saveUploadedFile('./uploads/products', file);
      imageUrl = saved.url;
    }

    // storeId dari token, bukan dari body
    return this.productService.create(dto, imageUrl, storeId);
  }

  @Get('/pagination')
  async findPagination(
    @Query('page') page = 1,
    @Query('size') size = 10,
    @StoreId() storeId: string,
  ) {
    const pageNumber = Math.max(1, Number(page));
    const pageSize = Math.max(1, Number(size));

    return this.productService.getPagination(pageNumber, pageSize, storeId);
  }

  @Get()
  async findAll(@StoreId() storeId: string) {
    return this.productService.findAll(storeId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @StoreId() storeId: string) {
    return this.productService.findOne(id, storeId);
  }

  @Patch(':id')
  @UseInterceptors(UploadInterceptor('image'))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @UploadedFile() file: Express.Multer.File,
    @StoreId() storeId: string,
  ) {
    let imageUrl: string | undefined;

    if (file) {
      const saved = saveUploadedFile('./uploads/products', file);
      imageUrl = saved.url;
    }

    return this.productService.update(id, dto, imageUrl, storeId);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @StoreId() storeId: string) {
    return this.productService.remove(id, storeId);
  }
}
