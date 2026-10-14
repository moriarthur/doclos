import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Response } from 'express';

// PD-R2: quota rejections are 429s with the same shape the rate limiter uses
// (statusCode / error / message / retryAfterSeconds) plus a standard
// Retry-After header, so clients treat "too many uploads" and "too many
// requests" identically.
export class QuotaExceededException extends HttpException {
  constructor(message: string, readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: 429,
        error: 'Too Many Requests',
        message,
        retryAfterSeconds,
      },
      429,
    );
  }
}

@Catch(QuotaExceededException)
export class QuotaExceptionFilter implements ExceptionFilter {
  catch(exception: QuotaExceededException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    response.status(429).json(exception.getResponse());
  }
}
