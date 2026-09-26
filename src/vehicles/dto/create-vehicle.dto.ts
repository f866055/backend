import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  VEHICLE_OBSERVATION_MAX_LENGTH,
  VEHICLE_TYPES,
} from '../entities/vehicle.entity';

export class CreateVehicleDto {
  /*
    Formato flexible: el usuario/OCR puede escribir "ABC-1234", "abc 1234", etc.
    El servicio normaliza (mayúsculas, sin separadores) y valida el largo; las
    reglas de formato peruano viven en plates.config.ts (advertencia, no rechazo).
  */
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9\s._-]{2,18}$/, {
    message:
      'La placa debe iniciar y terminar con caracteres alfanuméricos (letras, números, espacios o guion)',
  })
  plate: string;

  // Texto original capturado por OCR/cámara, si difiere de lo tipeado.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  plateRaw?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  brand?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  model?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  color?: string | null;

  // Campo obligatorio mínimo junto a la placa.
  @IsIn(VEHICLE_TYPES, {
    message: `El tipo debe ser uno de: ${VEHICLE_TYPES.join(', ')}`,
  })
  type: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ownerName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(VEHICLE_OBSERVATION_MAX_LENGTH)
  observation?: string | null;
}
