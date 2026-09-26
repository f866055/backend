import { BadRequestException, ConflictException } from '@nestjs/common';

// Código estructurado que distingue los motivos de una búsqueda fallida en
// Caja: un ticket que YA se cobró (ALREADY_PAID) no es un "no existe"; un
// ticket cerrado sin cobro se considera anulado (CANCELLED).
export type LookupConflictCode = 'ALREADY_PAID' | 'CANCELLED';

export class PaymentLookupException extends BadRequestException {
  constructor(message: string, readonly code: LookupConflictCode) {
    super(message);
  }
}