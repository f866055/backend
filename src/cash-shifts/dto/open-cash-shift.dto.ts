import { IsNumber, IsOptional, Min } from 'class-validator';

// Apertura de caja. El único insumo obligatorio es el fondo/monto inicial con
// el que se abre el turno (>= 0). El cajero lo aporta el token (CurrentUser) y
// la fecha/hora la registra el backend al crear el turno.
export class OpenCashShiftDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  openingFund?: number;
}