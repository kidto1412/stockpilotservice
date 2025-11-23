import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/auth.dto';
import { JwtAuthGuard } from 'src/utils/jwt-auth-guard.util';

import { CREATED } from 'src/common/constant/operations.constant';
import { CreateUserDto } from 'src/users/dto/user.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.username, dto.password);
  }
  @Post('register')
  async register(@Body() dto: CreateUserDto) {
    await this.authService.register(dto);
    return CREATED;
  }

  @UseGuards(JwtAuthGuard)
  @Get('verify')
  verify() {
    return { valid: true };
  }
}
