import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { ParkingEntry } from '../../vehicles/entities/parking-entry.entity';

/**
 * Métodos de cobro soportados en la caja de GaragePro:
 * - CASH: Efectivo con registro de monto entregado y cálculo exacto de cambio.
 * - CARD: Tarjeta de crédito o débito mediante terminal POS.
 * - YAPE / PLIN: Billeteras digitales móviles con código QR / número telefónico.
 * - TRANSFER: Transferencia o depósito bancario directo.
 * - CREDIT: Abono parcial a cuenta del ticket (no finaliza la estancia).
 */
export enum PaymentMethod {
  CASH = 'cash',
  CARD = 'card',
  YAPE = 'yape',
  PLIN = 'plin',
  TRANSFER = 'transfer',
  CREDIT = 'credit',
}

export enum PaymentStatus {
  PAID = 'paid',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * ==============================================================================
 * TABLA: payments (TRANSACCIONES DE COBRO Y LIQUIDACIÓN)
 * ==============================================================================
 * Registra cada cobro o abono monetario asociado a una estancia vehicular:
 * 
 * 1. RELACIÓN CON EL TICKET (parking_entries):
 *    - Cada transacción se vincula a un ingreso específico (`parking_entry_id`).
 * 
 * 2. CÁLCULO MONETARIO EXACTO:
 *    - `amount`: Importe total cobrado en la transacción (calculado por el backend
 *      considerando horas completas/fracciones, minutos de gracia y tarifas aplicables).
 *    - `amountReceived` y `changeAmount`: Control de efectivo y vuelto entregado.
 * 
 * 3. CONTROL DE ABONOS VS. LIQUIDACIÓN FINAL:
 *    - Si method = 'credit', representa un anticipo o pago parcial a cuenta.
 *    - Si liquida el saldo restante, el ticket asociado finaliza y el vehículo sale.
 * ==============================================================================
 */
@Entity('pagos')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ParkingEntry, { nullable: false })
  @JoinColumn({ name: 'entrada_id' })
  entry: ParkingEntry;

  @Exclude()
  @Column({ name: 'entrada_id' })
  entryId: string;

  // Código legible del ticket pagado (denormalizado para reportes/cobros).
  @Column({ name: 'codigo_ticket', length: 20 })
  ticketCode: string;

  // Total a cobrar calculado por el backend (NUMERIC(10,2)).
  @Column({ name: 'monto', type: 'numeric', precision: 10, scale: 2 })
  amount: string;

  @Column({ name: 'metodo', type: 'enum', enum: PaymentMethod, enumName: 'pagos_metodo_enum' })
  method: PaymentMethod;

  // Dinero entregado por el cliente (solo cash). NUMERIC(10,2).
  @Column({
    name: 'monto_recibido',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  amountReceived: string | null;

  // Cambio a devolver (solo cash): amount_received - amount.
  @Column({
    name: 'monto_cambio',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  changeAmount: string | null;

  @Column({ name: 'estado', type: 'enum', enum: PaymentStatus, enumName: 'pagos_estado_enum', default: PaymentStatus.PAID })
  status: PaymentStatus;

  // Momento en que se registró el pago (= hora de salida del vehículo).
  @CreateDateColumn({ name: 'fecha_pago', type: 'timestamptz' })
  paidAt: Date;

  @Index('idx_pagos_entrada', { unique: false })
  @CreateDateColumn({ name: 'creado_en', type: 'timestamptz' })
  createdAt: Date;

  // Turno de caja en el que se registró el pago (null para pagos históricos
  // anteriores a la tabla de turnos). Se asigna al cobrar con caja activa.
  @Column({ name: 'turno_caja_id', type: 'uuid', nullable: true })
  cashShiftId: string | null;

  /** Nº de operación legible para comprobantes (OP-…). Null en pagos viejos. */
  @Column({
    name: 'numero_operacion',
    type: 'varchar',
    length: 32,
    nullable: true,
    unique: true,
  })
  operationNumber: string | null;
}
