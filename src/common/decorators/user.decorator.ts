import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

export const UserId = createParamDecorator((_, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();

  if (!req.user) {
    throw new UnauthorizedException('req.user tidak ditemukan');
  }

  return req.user.userId;
});

export const StoreId = createParamDecorator((_, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();

  if (!req.user) {
    throw new UnauthorizedException('req.user tidak ditemukan');
  }

  return req.user.storeId;
});
