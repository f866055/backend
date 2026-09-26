import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * ==============================================================================
 * TABLA: garage_settings (CONFIGURACIÓN OPERATIVA DEL ESTABLECIMIENTO)
 * ==============================================================================
 * Registro singleton que gobierna las reglas globales del garaje GaragePro:
 *
 * 1. CAPACIDAD Y CONTROL DE AFORO (totalSpaces):
 *    - Define el número máximo de plazas físicas disponibles en el estacionamiento.
 *    - Se usa para calcular la ocupación porcentual y plazas libres en tiempo real.
 *
 * 2. TARIFACIÓN GENERAL (ratePerHour, currency):
 *    - Tarifa horaria base aplicada en la caja al liquidar los tickets.
 *    - Moneda oficial del sistema (PEN, USD, EUR, etc.).
 *
 * 3. IDENTIFICACIÓN Y ZONA HORARIA:
 *    - Nombre comercial que se imprime en los tickets y comprobantes.
 *    - `timezone`: Garantiza que el cálculo de horas y arqueo sea fiel a la hora local.
 * ==============================================================================
 */
@Entity('configuracion_garaje')
export class GarageSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'nombre_garaje', length: 120, default: 'GaragePro' })
  garageName: string;

  @Column({ name: 'nombre_terminal', length: 60, default: 'Terminal 01' })
  terminalName: string;

  @Column({ name: 'total_plazas', type: 'int', default: 40 })
  totalSpaces: number;

  // Tarifa por hora (moneda local) usada para calcular el total de un ticket
  // al momento de cobrar la salida. NUMERIC(10,2) para dinero exacto.
  @Column({
    name: 'tarifa_por_hora',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 2.0,
  })
  ratePerHour: number;

  @Column({ name: 'moneda', length: 3, default: 'PEN' })
  currency: string;

  @Column({ name: 'zona_horaria', length: 64, default: 'America/Lima' })
  timezone: string;

  @CreateDateColumn({ name: 'creado_en' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'actualizado_en' })
  updatedAt: Date;
}
