import { IsIn, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaymentMethod } from '../entities/payment.entity';

// Pago de una salida. Se identifica el ticket por su id (UUID de
// parking_entries) o por su código legible (ej. "TK-8829"); exactamente uno
// de los dos debe venir. paymentMethod acepta todos los métodos de cierre
// (efectivo, tarjeta, Yape, Plin, transferencia); los abonos se gestionan por
// el recurso de abonos. amountReceived solo aplica a método cash.
export class CreatePaymentDto {
  @IsOptional()
  @IsUUID()
  ticketId?: string;

  @IsOptional()
  @IsString()
  ticketCode?: string;

  @IsIn([
    PaymentMethod.CASH,
    PaymentMethod.CARD,
    PaymentMethod.YAPE,
    PaymentMethod.PLIN,
    PaymentMethod.TRANSFER,
  ])
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  amountReceived?: number;
}
