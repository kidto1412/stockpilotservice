import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { GlobalResponseInterceptor } from './common/interceptors/response.interceptor';
import { GlobalHttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestResponseLoggingInterceptor } from './common/interceptors/request-response-logging.interceptor';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'debug', 'verbose'],
  });
  app.setGlobalPrefix('stockpilot');
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // hapus field yang tidak ada di DTO
      forbidNonWhitelisted: true, // (opsional) tolak request jika ada field asing
      transform: true, // otomatis ubah tipe data ke tipe DTO
    }),
  );
  // ✅ Response dan Exception global
  app.useGlobalInterceptors(
    new RequestResponseLoggingInterceptor(),
    new GlobalResponseInterceptor(),
  );
  app.useGlobalFilters(new GlobalHttpExceptionFilter());

  await app.listen(process.env.PORT ?? 3010);
}
bootstrap();
