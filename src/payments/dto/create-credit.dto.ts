import { IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

// Registro de un ABONO (pago a cuenta) sobre un ticket ACTIVO. Se identifica el
// ticket por su id (UUID de parking_entries) o por su código legible (ej.
// "TK-8829"); exactamente uno de los dos debe venir. amount es el monto que el
// cliente entrega a cuenta; NO cierra el ticket (sigue ACTIVO) y reduce el
// saldo pendiente. Solo se aceptan cantidades positivas y no mayores al saldo
// pendiente (validado en el servicio).
export class CreateCreditDto {
  @IsOptional()
  @IsUUID()
  ticketId?: string;

  @IsOptional()
  @IsString()
  ticketCode?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;
}
