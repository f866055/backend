import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Valores soportados por el negocio; se amplían explícitamente aquí.
// Se conservan los valores históricos (Sedán, SUV, Motocicleta) para no romper
// vehículos ya registrados, y se agrega el catálogo operativo ampliado.
export const VEHICLE_TYPES = [
  'Sedán',
  'SUV',
  'Motocicleta',
  'Hatchback',
  'Pickup',
  'Coupé',
  'Station Wagon',
  'Minivan',
  'Furgón',
  'Camioneta',
  'Mototaxi',
  'Moto',
  'Camión',
  'Bus',
  'Taxi',
  'Otro',
] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_OBSERVATION_MAX_LENGTH = 500;

/**
 * ==============================================================================
 * TABLA: vehicles (CATÁLOGO MAESTRO DE VEHÍCULOS)
 * ==============================================================================
 * Mantiene el registro de vehículos que han ingresado al garaje GaragePro:
 *
 * 1. UNICIDAD Y NORMALIZACIÓN DE PLACAS:
 *    - `plateNormalized` es la clave canónica (mayúsculas, sin espacios ni símbolos)
 *      que garantiza que "ABC-123", "abc 123" o "ABC123" correspondan al mismo vehículo.
 *    - `plate`: Versión formateada para su impresión en tickets y reportes.
 *
 * 2. SEGMENTACIÓN Y TARIFACIÓN:
 *    - El campo `type` (Sedán, SUV, Motocicleta, Pickup, etc.) permite aplicar
 *      tarifas horarias diferenciadas configuradas en el sistema.
 *
 * 3. IDENTIFICACIÓN Y ESTADO:
 *    - Almacena datos opcionales de marca, modelo, color y observaciones (ej: rayones
 *      o abolladuras previas para resguardo del garaje).
 * ==============================================================================
 */
@Entity('vehiculos')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Placa tal como fue ingresada (tipeada o leída por OCR), recortada de
  // extremos: texto visible para tickets, reportes y actividad reciente.
  @Column({ name: 'placa', type: 'varchar', length: 15 })
  plate: string;

  /*
    Clave canónica de negocio: mayúsculas sin espacios/guiones/puntos
    (normalizePlate() en plates.config.ts). ÚNICO índice de unicidad: hace la
    búsqueda y la prevención de duplicados insensibles a "ABC-1234"/"abc 1234".
    NOT NULL lo aplica la migración 1787500000000; el decorator queda nullable
    para convivir con synchronize:true en desarrollo.
  */
  @Index('ux_vehiculos_placa_normalizada', { unique: true })
  @Column({
    name: 'placa_normalizada',
    type: 'varchar',
    length: 15,
    nullable: true,
  })
  plateNormalized: string | null;

  // Texto original de la PRIMERA captura (antes de normalizar). Opcional.
  @Column({
    name: 'placa_original',
    type: 'varchar',
    length: 15,
    nullable: true,
  })
  plateRaw: string | null;

  @Column({ name: 'marca', type: 'varchar', length: 60, nullable: true })
  brand: string | null;

  @Column({ name: 'modelo', type: 'varchar', length: 60, nullable: true })
  model: string | null;

  @Column({ name: 'color', type: 'varchar', length: 40, nullable: true })
  color: string | null;

  @Column({
    name: 'tipo',
    type: 'enum',
    enum: VEHICLE_TYPES,
    enumName: 'vehiculos_tipo_enum',
  })
  type: VehicleType;

  @Column({
    name: 'nombre_propietario',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  ownerName: string | null;

  @Column({ name: 'telefono', type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  // Observación del operador sobre el vehículo/ingreso. Opcional.
  @Column({
    name: 'observacion',
    type: 'varchar',
    length: VEHICLE_OBSERVATION_MAX_LENGTH,
    nullable: true,
  })
  observation: string | null;

  @CreateDateColumn({ name: 'creado_en' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'actualizado_en' })
  updatedAt: Date;
}
