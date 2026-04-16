import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalHttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    if (typeof message === 'object' && (message as any).message) {
      message = (message as any).message;
    }

    const safePayload = this.sanitize({
      params: request?.params,
      query: request?.query,
      body: request?.body,
    });

    this.logger.error(
      `[ERROR] ${request?.method} ${request?.url} status=${status} message=${JSON.stringify(message)} payload=${JSON.stringify(safePayload)}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json({
      //   success: false,
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private sanitize(value: unknown, depth = 0): unknown {
    if (depth > 4) {
      return '[max-depth]';
    }

    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.slice(0, 50).map((item) => this.sanitize(item, depth + 1));
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
