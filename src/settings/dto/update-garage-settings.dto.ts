import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateGarageSettingsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  garageName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  terminalName: string;

  @IsInt()
  @Min(1)
  @Max(100000)
  totalSpaces: number;

  // Tarifa por hora en la moneda local. NUMERIC(10,2) en la base de datos.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  ratePerHour: number;

  // Valores soportados por el negocio; se ampliarán explícitamente aquí.
  @IsIn(['PEN'])
  currency: string;

  @IsIn(['America/Lima'])
  timezone: string;
}
