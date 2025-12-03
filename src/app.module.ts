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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthContextMiddleware)
      .exclude('auth/login', 'auth/register')
      .forRoutes('*');
  }
}
