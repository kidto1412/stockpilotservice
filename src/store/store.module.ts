import { Module } from '@nestjs/common';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'SECRET_JWT_KEY',
      signOptions: { expiresIn: '1d' }, // token berlaku 1 hari
    }),
  ],
  controllers: [StoreController],
  providers: [StoreService],
})
export class StoreModule {}
