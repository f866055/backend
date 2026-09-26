import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PaymentLookupException } from './payment-lookup.exception';

// Filtro para errores de búsqueda de cobro: incluye el código estructurado
// (ALREADY_PAID / CANCELLED) en el cuerpo de la respuesta para que el frontend
// distinga los escenarios, imitando el convenio de conflicto de vehículos.
@Catch(PaymentLookupException)
export class PaymentLookupExceptionFilter implements ExceptionFilter {
  catch(exception: PaymentLookupException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message: exception.message,
      code: exception.code,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}