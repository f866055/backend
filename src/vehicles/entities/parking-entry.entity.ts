import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Vehicle } from './vehicle.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Estado operativo del ticket de ingreso en el ciclo de vida de GaragePro:
 * - ACTIVO: El vehículo se encuentra actualmente dentro del garaje ocupando una plaza.
 * - FINALIZADO: El vehículo pagó su estancia en caja, se registró su salida y se liberó el espacio.
 */
export enum EntryStatus {
  ACTIVO = 'ACTIVO',
  FINALIZADO = 'FINALIZADO',
}

/**
 * ==============================================================================
 * TABLA: parking_entries (TICKETS Y ESTANCIAS VEHICULARES)
 * ==============================================================================
 * Entidad central del negocio de estacionamiento GaragePro.
 * Cada fila representa una estancia vehicular desde su acceso hasta su salida:
 *
 * 1. INGRESO:
 *    - Se genera un código alfanumérico único para el ticket (ej: #TK-1001).
 *    - Se asocia al vehículo registrado (`vehicle_id`) y al operador (`created_by_id`).
 *    - Se fija el instante de entrada con precisión en `entryAt`.
 *
 * 2. PERMANENCIA:
 *    - Mientras `exitAt` sea null y `status` sea ACTIVO, el vehículo computa como
 *      plaza ocupada en el cálculo de aforo en tiempo real del garaje.
 *
 * 3. LIQUIDACIÓN Y SALIDA:
 *    - Al pasar por caja, el backend calcula la diferencia temporal (exitAt - entryAt),
 *      aplica la tarifa por categoría y minutos de gracia, procesa el cobro en
 *      la tabla `payments` y transiciona el estado a FINALIZADO, liberando la plaza.
 * ==============================================================================
 */
@Entity('entradas_estacionamiento')
export class ParkingEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Código legible para el operador (ej. #TK-8829).
  @Column({ name: 'codigo_ticket', length: 20, unique: true })
  ticketCode: string;

  @ManyToOne(() => Vehicle, { nullable: false })
  @JoinColumn({ name: 'vehiculo_id' })
  vehicle: Vehicle;

  @Exclude()
  @Column({ name: 'vehiculo_id' })
  vehicleId: string;

  @CreateDateColumn({ name: 'fecha_ingreso', type: 'timestamptz' })
  entryAt: Date;

  @Column({ name: 'fecha_salida', type: 'timestamptz', nullable: true })
  exitAt: Date | null;

  @Column({
    name: 'estado',
    type: 'enum',
    enum: EntryStatus,
    enumName: 'entradas_estacionamiento_estado_enum',
    default: EntryStatus.ACTIVO,
  })
  status: EntryStatus;

  // Operador que registró este ingreso. Se persiste para que la reimpresión
  // del ticket muestre SIEMPRE quién realizó la operación (no el usuario que
  // consulta después). La relación guarda solo el id; el nombre se resuelve
  // desde User al construir el ticket (sin duplicar información).
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'creado_por_id' })
  createdBy: User | null;

  @Exclude()
  @Column({ name: 'creado_por_id', nullable: true })
  createdById: string | null;

  @UpdateDateColumn({ name: 'actualizado_en' })
  updatedAt: Date;
}
