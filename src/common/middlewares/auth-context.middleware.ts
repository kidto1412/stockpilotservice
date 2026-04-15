import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthContextMiddleware.name);

  constructor(private jwt: JwtService) {}

  use(req: any, res: any, next: () => void) {
    // Logger awal
    this.logger.debug(`Incoming request: ${req.method} ${req.originalUrl}`);

    // Skip route login/register
    if (
      req.originalUrl === '/' ||
      req.originalUrl.includes('/auth/login') ||
      req.originalUrl.includes('/auth/register') ||
      req.originalUrl.includes('/stock-analysis')
    ) {
      return next();
    }

    const auth = req.headers.authorization;
    if (!auth) {
      throw new UnauthorizedException('Token tidak ada');
    }

    const token = auth.replace('Bearer ', '').trim();

    try {
      // Decode tanpa verifikasi
      const payload = this.jwt.decode(token);

      if (!payload) {
        throw new UnauthorizedException('Token decode gagal');
      }

      // SIMPAN DI authContext, bukan req.user
      req.authContext = payload;

      this.logger.debug(`Decoded token: ${JSON.stringify(payload)}`);
    } catch (err) {
      this.logger.error(`Token error: ${err.message}`);
      throw new UnauthorizedException('Token tidak valid');
    }

    next();
  }
}
