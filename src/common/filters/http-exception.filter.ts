import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    let code = 'INTERNAL_ERROR';
    let message = exception.message;

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const r = exceptionResponse as Record<string, unknown>;
      if (typeof r['code'] === 'string') code = r['code'];
      if (typeof r['message'] === 'string') message = r['message'];
    }

    response.status(status).json({ code, message, statusCode: status });
  }
}
