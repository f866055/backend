import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { User } from '../../users/entities/user.entity';

/**
 * Estado operativo del turno de caja:
 * - OPEN: Caja activa; se admiten cobros de estancias y abonos en el sistema.
 * - CLOSED: Caja arqueada y cerrada; se consolidan los importes por método de pago.
 */
export enum CashShiftStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

/**
 * ==============================================================================
 * TABLA: cash_shifts (CONTROL DE TURNOS DE CAJA Y ARQUEO)
 * ==============================================================================
 * Gestiona los turnos laborales de los cajeros en GaragePro para auditoría contable:
 *
 * 1. FONDO INICIAL (openingFund):
 *    - Dinero en efectivo con el que arranca el turno para dar cambio a los clientes.
 *
 * 2. TRAZABILIDAD DEL OPERADOR:
 *    - `openedBy`: Cajero responsable del turno durante la franja horaria.
 *    - `openedAt` y `closedAt`: Marcas temporales exactas del turno.
 *
 * 3. REGLA DE UNICIDAD OPERATIVA:
 *    - Solo puede existir una caja en estado OPEN simultáneamente, garantizando
 *      que cada cobro registrado pertenezca con certeza al turno vigente.
 * ==============================================================================
 */
@Entity('turnos_caja')
export class CashShift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'estado',
    type: 'enum',
    enum: CashShiftStatus,
    enumName: 'turnos_caja_estado_enum',
    default: CashShiftStatus.OPEN,
  })
  status: CashShiftStatus;

  // Cajero que abrió la caja (se persiste al abrir; el nombre se resuelve al
  // construir el resumen, igual patrón que createdBy en parking_entries).
  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'abierto_por_id' })
  openedBy: User;

  @Exclude()
  @Column({ name: 'abierto_por_id' })
  openedById: string;

  // Fondo/monto inicial con el que se abre la caja (NUMERIC(10,2)).
  @Column({
    name: 'fondo_apertura',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  openingFund: string;

  // Momento de apertura (= hora de inicio del turno). Se fija explícitamente
  // al abrir la caja (no es un auto timestamp para que sea reproducible).
  @Column({
    name: 'fecha_apertura',
    type: 'timestamptz',
    default: () => 'now()',
  })
  openedAt: Date;

  // Momento de cierre; null mientras la caja siga abierta.
  @Column({ name: 'fecha_cierre', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @UpdateDateColumn({ name: 'actualizado_en', type: 'timestamptz' })
  updatedAt: Date;
}
