import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

@Injectable()
export class GlobalResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        const response = context.switchToHttp().getResponse();
        response.status(200);

        const statusCode = 200;

        const messageMap: Record<number, string> = {
          200: 'Success',
          201: 'Created',
          400: 'Bad Request',
          404: 'Data Not Found',
          500: 'Internal Server Error',
        };

        const message = messageMap[statusCode] ?? 'Success';

        // Cek apakah data sudah ada 'meta'
        if (
          data &&
          typeof data === 'object' &&
          'meta' in data &&
          'data' in data
        ) {
          return {
            success: true,
            statusCode,
            message,
            ...data, // biarkan meta dan data apa adanya
          };
        }

        return {
          success: statusCode < 400,
          statusCode,
          message,
          data,
          ...(data && typeof data === 'object' && !Array.isArray(data)
            ? data
            : {}),
        };
      }),
    );
  }
}
