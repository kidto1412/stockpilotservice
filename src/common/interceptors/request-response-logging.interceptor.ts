import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class RequestResponseLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestResponseLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const method = request?.method;
    const path = request?.originalUrl || request?.url;
    const startedAt = Date.now();

    const requestPayload = this.sanitize({
      params: request?.params,
      query: request?.query,
      body: request?.body,
    });

    this.logger.log(
      `[REQUEST] ${method} ${path} payload=${JSON.stringify(requestPayload)}`,
    );

    return next.handle().pipe(
      tap({
        next: (data) => {
          const durationMs = Date.now() - startedAt;
          const summary = this.responseSummary(this.sanitize(data));

          this.logger.log(
            `[RESPONSE] ${method} ${path} status=success durationMs=${durationMs} summary=${summary}`,
          );
        },
        error: (error) => {
          const durationMs = Date.now() - startedAt;
          const message =
            error instanceof Error ? error.message : 'Unknown error';

          this.logger.error(
            `[RESPONSE] ${method} ${path} status=error durationMs=${durationMs} message=${message}`,
          );
        },
      }),
    );
  }

  private responseSummary(data: unknown): string {
    if (Array.isArray(data)) {
      return `array(length=${data.length})`;
    }

    if (data && typeof data === 'object') {
      const keys = Object.keys(data as Record<string, unknown>).slice(0, 12);
      return `object(keys=${keys.join(',')})`;
    }

    return String(data);
  }

  private sanitize(value: unknown, depth = 0): unknown {
    if (depth > 4) {
      return '[max-depth]';
    }

    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      const limited = value.slice(0, 50);
      return limited.map((item) => this.sanitize(item, depth + 1));
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const output: Record<string, unknown> = {};

      for (const [key, val] of Object.entries(record)) {
        const lowered = key.toLowerCase();
        if (
          lowered.includes('password') ||
          lowered.includes('token') ||
          lowered.includes('authorization') ||
          lowered.includes('secret')
        ) {
          output[key] = '[redacted]';
          continue;
        }
        output[key] = this.sanitize(val, depth + 1);
      }

      return output;
    }

    if (typeof value === 'string' && value.length > 500) {
      return `${value.slice(0, 500)}...[truncated]`;
    }

    return value;
  }
}
