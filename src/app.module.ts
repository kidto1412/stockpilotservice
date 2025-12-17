import { MiddlewareConsumer, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { StoreModule } from './store/store.module';
import { LoggerMiddleware } from './common/middlewares/logger.middleware';
import { AuthModule } from './auth/auth.module';
import { LocationModule } from './location/location.module';
import { BusinessTypeModule } from './business-type/business-type.module';
import { JwtModule } from '@nestjs/jwt';
import { AuthContextMiddleware } from './common/middlewares/auth-context.middleware';
import { AuthGuard } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { StaffService } from './staff/staff.service';
import { StaffController } from './staff/staff.controller';
import { StaffModule } from './staff/staff.module';
import { JwtAuthGuard } from './utils/jwt-auth-guard.util';
import { CategoryModule } from './category/category.module';
import { ProductService } from './product/product.service';
import { ProductController } from './product/product.controller';
import { ProductModule } from './product/product.module';
import { DiscountModule } from './discount/discount.module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
    }),

    PrismaModule,
    UsersModule,
    StoreModule,
    AuthModule,
    LocationModule,
    BusinessTypeModule,
    StaffModule,
    CategoryModule,
    ProductModule,
    DiscountModule,
  ],
  controllers: [AppController, StaffController, ProductController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    StaffService,
    ProductService,
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthContextMiddleware)
      .exclude('auth/login', 'auth/register')
      .forRoutes('*');
  }
}
