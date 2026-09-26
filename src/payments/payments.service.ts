import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import {
  EntryStatus,
  ParkingEntry,
} from '../vehicles/entities/parking-entry.entity';
import { GarageSetting } from '../settings/entities/garage-setting.entity';
import {
  normalizePlate,
  isValidNormalizedLength,
} from '../vehicles/plates.config';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreateCreditDto } from './dto/create-credit.dto';
import {
  Payment,
  PaymentMethod,
  PaymentStatus,
} from './entities/payment.entity';
import { CashShiftsService } from '../cash-shifts/cash-shifts.service';
import { PaymentLookupException } from './exceptions/payment-lookup.exception';

// 2 decimales fijos; evita errores de punto flotante al guardar/cobrar.
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Fallback de tarifa por hora si aún no hay configuración.
const DEFAULT_RATE_PER_HOUR = 2.0;
const DEFAULT_CURRENCY = 'PEN';

/** Inicio (00:00:00) de una fecha local. */
function startOfDay(value: Date): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Fin (23:59:59.999) de una fecha local. */
function endOfDay(value: Date): Date {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

// Nº de operación legible y prácticamente único (ej. OP-8M2K1Q3C),
// consistente con el formato de ticket (TK-…) usado por el proyecto.
function generateOperationNumber(): string {
  const time = Date.now().toString(36).toUpperCase();
  const random = Math.floor(Math.random() * 1296)
    .toString(36)
    .toUpperCase()
    .padStart(2, '0');
  return `OP-${time}${random}`;
}

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(ParkingEntry)
    private readonly entriesRepository: Repository<ParkingEntry>,
    @InjectRepository(GarageSetting)
    private readonly settingsRepository: Repository<GarageSetting>,
    private readonly dataSource: DataSource,
    private readonly cashShiftsService: CashShiftsService,
  ) {}

  /** Obtiene la tarifa por hora desde la configuración (fila única). */
  private async getRatePerHour(manager?: EntityManager): Promise<number> {
    const repo = manager
      ? manager.getRepository(GarageSetting)
      : this.settingsRepository;
    const rows = await repo.find({ order: { createdAt: 'ASC' }, take: 1 });
    if (!rows[0]) return DEFAULT_RATE_PER_HOUR;
    const rate = Number(rows[0].ratePerHour);
    return Number.isFinite(rate) && rate >= 0 ? rate : DEFAULT_RATE_PER_HOUR;
  }

  /**
   * Total REAL calculado en el backend: horas transcurridas (fraccionales)
   * desde entryAt hasta ahora × tarifa por hora, con 2 decimales.
   */
  private computeTotal(entryAt: Date, ratePerHour: number, now: Date): number {
    const hours = Math.max(0, (now.getTime() - entryAt.getTime()) / 3_600_000);
    return round2(hours * ratePerHour);
  }

  /**
   * Formatea los números de PostgreSQL (devueltos como string) a números JSON.
   */
  private asNumber(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /** Suma de los ABONOS (method='credit') registrados sobre un ingreso. */
  private async creditedFor(
    entryId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const repo = manager
      ? manager.getRepository(Payment)
      : this.paymentsRepository;
    const rows = await repo
      .createQueryBuilder('p')
      .select('COALESCE(SUM(p.amount), 0)', 'total')
      .where('p.entryId = :entryId', { entryId })
      .andWhere('p.method = :credit', { credit: PaymentMethod.CREDIT })
      .getRawOne<{ total: string }>();
    const total = Number(rows?.total ?? 0);
    return Number.isFinite(total) ? round2(total) : 0;
  }

  /** Saldo pendiente de un ingreso: total actual − suma de abonos (>= 0). */
  private pendingBalance(total: number, credited: number): number {
    return round2(Math.max(0, total - credited));
  }

  /** Historial de ABONOS (pago a cuenta) registrados sobre un ingreso. */
  private async creditsFor(
    entryId: string,
    manager?: EntityManager,
  ): Promise<{ id: string; amount: number; method: string; paidAt: string }[]> {
    const repo = manager
      ? manager.getRepository(Payment)
      : this.paymentsRepository;
    const rows = await repo.find({
      where: { entryId, method: PaymentMethod.CREDIT, status: PaymentStatus.PAID },
      order: { paidAt: 'ASC' },
    });
    return rows.map((row) => ({
      id: row.id,
      amount: this.asNumber(row.amount) ?? 0,
      method: row.method,
      paidAt: row.paidAt.toISOString(),
    }));
  }

  /**
   * Búsqueda de la salida: encuentra el INGRESO ACTIVO de un vehículo.
   * `query` puede ser un código de ticket (#TK-8829, TK-8829) o una placa
   * (MNO-456, mno456). Devuelve datos reales de BD + total/duración calculados,
   * así como los abonos ya registrados y el saldo pendiente.
   */
  async lookupActiveEntry(query: string): Promise<{
    entry: Pick<
      ParkingEntry,
      'id' | 'ticketCode' | 'entryAt' | 'exitAt' | 'status'
    >;
    vehicle: Pick<
      Vehicle,
      | 'plate'
      | 'plateRaw'
      | 'plateNormalized'
      | 'brand'
      | 'model'
      | 'color'
      | 'type'
    >;
    total: number;
    ratePerHour: number;
    currency: string;
    durationMs: number;
    credited: number;
    pending: number;
    credits: { id: string; amount: number; method: string; paidAt: string }[];
  }> {
    const raw = (query ?? '').trim();
    if (!raw) {
      throw new BadRequestException('Ingresa un ticket o placa para buscar');
    }

    // La placa va sin "#" ni guiones; el ticket empieza con "TK-".
    const cleanRaw = raw.replace(/^#/, '').trim().toUpperCase();
    const normalizedPlate = normalizePlate(cleanRaw);
    const ticketCode = cleanRaw.startsWith('TK') ? cleanRaw : null;

    console.log(`[PAYMENT] Buscando ingreso activo: "${raw}"`);

    let entry: ParkingEntry | null = null;
    if (ticketCode) {
      console.log(`[PAYMENT] Por ticket: ${ticketCode}`);
      entry = await this.entriesRepository.findOne({
        where: {
          ticketCode,
          status: EntryStatus.ACTIVO,
        },
        relations: { vehicle: true },
      });

      // Ticket con salida cerrada (ya pagado): se informa para que el cajero
      // no lo intente cobrar de nuevo. No es un "no existe".
      if (!entry) {
        const finalized = await this.entriesRepository.findOne({
          where: { ticketCode },
          relations: { vehicle: true },
        });
        if (finalized) {
          const hasPayments =
            (await this.paymentsRepository.countBy({
              entryId: finalized.id,
            })) > 0;
          throw new PaymentLookupException(
            hasPayments
              ? `El ticket ${finalized.ticketCode} ya fue cobrado y la salida fue registrada.`
              : `El ticket ${finalized.ticketCode} está cerrado sin cobro (anulado).`,
            hasPayments ? 'ALREADY_PAID' : 'CANCELLED',
          );
        }
      }
    } else if (isValidNormalizedLength(normalizedPlate)) {
      console.log(`[PAYMENT] Por placa: ${normalizedPlate}`);
      const vehicle = await this.dataSource
        .getRepository(Vehicle)
        .findOne({ where: { plateNormalized: normalizedPlate } });
      if (vehicle) {
        entry = await this.entriesRepository.findOne({
          where: { vehicleId: vehicle.id, status: EntryStatus.ACTIVO },
          order: { entryAt: 'DESC' },
          relations: { vehicle: true },
        });

        // El vehículo no está dentro ahora, pero pudo haber salido: revisa su
        // último ingreso y, si ya se cobró, avisa con el detalle correspondiente.
        if (!entry) {
          const last = await this.entriesRepository.findOne({
            where: { vehicleId: vehicle.id },
            order: { entryAt: 'DESC' },
            relations: { vehicle: true },
          });
          if (last && last.status === EntryStatus.FINALIZADO) {
            const hasPayments =
              (await this.paymentsRepository.countBy({
                entryId: last.id,
              })) > 0;
throw new PaymentLookupException(
            hasPayments
              ? `La placa ${vehicle.plateRaw ?? vehicle.plate} ya salió (ticket ${last.ticketCode} cobrado).`
              : `La placa ${vehicle.plateRaw ?? vehicle.plate} ya salió y su ticket ${last.ticketCode} quedó sin cobro.`,
            hasPayments ? 'ALREADY_PAID' : 'CANCELLED',
          );
          }
        }
      }
    }

    if (!entry) {
      throw new NotFoundException(
        'No se encontró un vehículo activo con ese ticket o placa',
      );
    }

    const ratePerHour = await this.getRatePerHour();
    const now = new Date();
    const total = this.computeTotal(entry.entryAt, ratePerHour, now);
    const credited = await this.creditedFor(entry.id);
    const pending = this.pendingBalance(total, credited);

    console.log(`[PAYMENT] Ticket encontrado: ${entry.ticketCode}`);
    console.log(`[PAYMENT] Tarifa/hora: ${ratePerHour} — Total: ${total}`);
    console.log(`[PAYMENT] Abonado: ${credited} — Saldo pendiente: ${pending}`);

    return {
      entry: {
        id: entry.id,
        ticketCode: entry.ticketCode,
        entryAt: entry.entryAt,
        exitAt: entry.exitAt,
        status: entry.status,
      },
      vehicle: {
        plate: entry.vehicle.plate,
        plateRaw: entry.vehicle.plateRaw,
        plateNormalized: entry.vehicle.plateNormalized,
        brand: entry.vehicle.brand,
        model: entry.vehicle.model,
        color: entry.vehicle.color,
        type: entry.vehicle.type,
      },
      total,
      ratePerHour,
      currency: await this.settingsCurrencyOrDefault(),
      durationMs: Math.max(0, now.getTime() - entry.entryAt.getTime()),
      credited,
      pending,
      // Historial de abonos (pago a cuenta) en orden cronológico.
      credits: await this.creditsFor(entry.id),
    };
  }

  /**
   * Registra un ABONO (pago a cuenta) sobre un ticket ACTIVO. NO cierra el
   * ticket: solo reduce el saldo pendiente. Se valida que el abono sea mayor a
   * 0 y no supere el saldo pendiente actual. Bloquea la fila del ingreso para
   * evitar concursos al mismo tiempo que un cobro.
   */
  async registerCredit(dto: CreateCreditDto): Promise<{
    success: boolean;
    credit: {
      id: string;
      ticketCode: string;
      amount: number;
      method: PaymentMethod;
      status: PaymentStatus;
      operationNumber: string;
      paidAt: string;
    };
    ticketCode: string;
    credited: number;
    pending: number;
    total: number;
  }> {
    const hasTicketId = !!dto.ticketId;
    const hasTicketCode = !!dto.ticketCode?.trim();
    if (hasTicketId === hasTicketCode) {
      throw new BadRequestException(
        'Debes indicar el ticket por su id o por su código (no ambos)',
      );
    }

    if (!Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException('El monto del abono debe ser mayor a 0');
    }

    // Caja abierta obligatoria: sin un turno vivo no se registran cobros.
    const shift = await this.cashShiftsService.getOpenShift();
    if (!shift) {
      throw new ConflictException(
        'No hay una caja abierta. Abre la caja antes de registrar cobros.',
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const entry = await manager.getRepository(ParkingEntry).findOne({
        where: hasTicketId
          ? { id: dto.ticketId }
          : {
              ticketCode: dto
                .ticketCode!.trim()
                .replace(/^#/, '')
                .toUpperCase(),
            },
        relations: { vehicle: true },
        lock: { mode: 'pessimistic_write' },
      });

      if (!entry) {
        throw new NotFoundException('Ticket no encontrado');
      }

      if (entry.status !== EntryStatus.ACTIVO) {
        throw new ConflictException('Este ticket ya fue pagado y cerrado');
      }

      const ratePerHour = await this.getRatePerHour(manager);
      const now = new Date();
      const total = this.computeTotal(entry.entryAt, ratePerHour, now);
      const credited = await this.creditedFor(entry.id, manager);
      const pending = this.pendingBalance(total, credited);

      if (dto.amount > pending) {
        throw new BadRequestException(
          `El abono supera el saldo pendiente (${pending.toFixed(2)})`,
        );
      }

      const credit = await manager.getRepository(Payment).save({
        entryId: entry.id,
        ticketCode: entry.ticketCode,
        amount: String(round2(dto.amount)),
        method: PaymentMethod.CREDIT,
        amountReceived: null,
        changeAmount: null,
        status: PaymentStatus.PAID,
        cashShiftId: shift.id,
        operationNumber: generateOperationNumber(),
      });

      const newCredited = round2(credited + dto.amount);
      const newPending = this.pendingBalance(total, newCredited);

      return {
        credit,
        ticketCode: entry.ticketCode,
        credited: newCredited,
        pending: newPending,
        total,
      };
    });

    console.log(
      `[PAYMENT] Abono registrado: ${result.credit.id} — ${result.ticketCode} — pendiente ${result.pending}`,
    );

    return {
      success: true,
      credit: {
        id: result.credit.id,
        ticketCode: result.credit.ticketCode,
        amount: round2(dto.amount),
        method: result.credit.method,
        status: result.credit.status,
        operationNumber: result.credit.operationNumber ?? result.credit.id,
        paidAt: result.credit.paidAt.toISOString(),
      },
      ticketCode: result.ticketCode,
      credited: result.credited,
      pending: result.pending,
      total: result.total,
    };
  }

  /**
   * Procesa el pago FINAL y cierra el ticket en UNA transacción atómica:
   * registrar pago + cerrar ingreso (status FINALIZADO + exitAt) + liberar el
   * espacio (la ocupación cuenta solo los ACTIVO). El importe a cobrar es el
   * SALDO PENDIENTE (total − abonos). Si algo falla → ROLLBACK. Bloquea la fila
   * del ingreso para impedir DOBLE PAGO en concurrencia.
   */
  async processPayment(dto: CreatePaymentDto): Promise<{
    success: boolean;
    payment: {
      id: string;
      ticketCode: string;
      amount: number;
      method: PaymentMethod;
      amountReceived: number | null;
      change: number | null;
      status: PaymentStatus;
      operationNumber: string;
      paidAt: string;
    };
    entry: { id: string; ticketCode: string; entryAt: string; exitAt: string };
    total: number;
    credited: number;
  }> {
    const hasTicketId = !!dto.ticketId;
    const hasTicketCode = !!dto.ticketCode?.trim();
    if (hasTicketId === hasTicketCode) {
      throw new BadRequestException(
        'Debes indicar el ticket por su id o por su código (no ambos)',
      );
    }

    // El cobro FINAL nunca viene por el endpoint de pago si es un abono.
    if (dto.paymentMethod === PaymentMethod.CREDIT) {
      throw new BadRequestException(
        'Para registrar un abono usa el recurso de abonos',
      );
    }

    // Caja abierta obligatoria: sin un turno vivo no se procesan cobros.
    const shift = await this.cashShiftsService.getOpenShift();
    if (!shift) {
      throw new ConflictException(
        'No hay una caja abierta. Abre la caja antes de procesar cobros.',
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      // Lock de fila: serializa intentos concurrentes sobre el mismo ticket.
      const entry = await manager.getRepository(ParkingEntry).findOne({
        where: hasTicketId
          ? { id: dto.ticketId }
          : {
              ticketCode: dto
                .ticketCode!.trim()
                .replace(/^#/, '')
                .toUpperCase(),
            },
        relations: { vehicle: true },
        lock: { mode: 'pessimistic_write' },
      });

      if (!entry) {
        throw new NotFoundException('Ticket no encontrado');
      }

      // 1) Verificar que el ticket esté abierto (aún dentro del garaje).
      if (entry.status !== EntryStatus.ACTIVO) {
        throw new ConflictException('Este ticket ya fue pagado');
      }

      console.log(`[PAYMENT] Ticket encontrado: ${entry.ticketCode}`);

      // 2) Obtener el total real desde la BD y el saldo pendiente (total − abonos).
      const ratePerHour = await this.getRatePerHour(manager);
      const now = new Date();
      const total = this.computeTotal(entry.entryAt, ratePerHour, now);
      const credited = await this.creditedFor(entry.id, manager);
      const pending = this.pendingBalance(total, credited);
      console.log(
        `[PAYMENT] Total: ${total} — Abonado: ${credited} — Pendiente: ${pending}`,
      );
      console.log(`[PAYMENT] Método: ${dto.paymentMethod}`);

      // 3) Validar el método y (cash) el monto recibido contra el PENDIENTE.
      let amountReceived: number | null = null;
      let change: number | null = null;
      if (dto.paymentMethod === PaymentMethod.CASH) {
        const received = dto.amountReceived ?? 0;
        console.log(`[PAYMENT] Recibido: ${received}`);
        if (!Number.isFinite(received) || received < 0) {
          throw new BadRequestException('Monto recibido inválido');
        }
        if (received < pending) {
          // La BD sigue abierta: bad request dentro de la transacción.
          console.log(`[PAYMENT] Monto insuficiente: ${received} < ${pending}`);
          throw new BadRequestException('El monto recibido es insuficiente');
        }
        amountReceived = round2(received);
        change = round2(received - pending);
        console.log(`[PAYMENT] Cambio: ${change}`);
      }

      // 4) Registrar el pago por el SALDO PENDIENTE.
      console.log(`[PAYMENT] Registrando pago...`);
      const payment = await manager.getRepository(Payment).save({
        entryId: entry.id,
        ticketCode: entry.ticketCode,
        amount: String(pending),
        method: dto.paymentMethod,
        amountReceived: amountReceived !== null ? String(amountReceived) : null,
        changeAmount: change !== null ? String(change) : null,
        status: PaymentStatus.PAID,
        cashShiftId: shift.id,
        operationNumber: generateOperationNumber(),
      });

      // 5) Cerrar el ticket: marca salida y libera el espacio (deja de contar
      //    como ACTIVO). Misma transacción → si esto falla, se hace ROLLBACK.
      console.log(`[PAYMENT] Cerrando ticket ${entry.ticketCode}...`);
      entry.status = EntryStatus.FINALIZADO;
      entry.exitAt = now;
      await manager.getRepository(ParkingEntry).save(entry);
      console.log(`[PAYMENT] Ticket cerrado; espacio liberado`);

      return {
        payment,
        ticketCode: entry.ticketCode,
        entryAt: entry.entryAt,
        exitAt: now,
        total,
        credited,
        amountReceived,
        change,
        entryId: entry.id,
      };
    });

    const payment = result.payment;
    console.log(
      `[PAYMENT] Pago registrado: ${payment.id} — ${result.ticketCode} OK`,
    );

    return {
      success: true,
      payment: {
        id: payment.id,
        ticketCode: payment.ticketCode,
        amount: result.total - result.credited,
        method: payment.method,
        amountReceived: result.amountReceived,
        change: result.change,
        status: payment.status,
        operationNumber: payment.operationNumber ?? payment.id,
        paidAt: payment.paidAt.toISOString(),
      },
      entry: {
        id: result.entryId,
        ticketCode: payment.ticketCode,
        entryAt: result.entryAt.toISOString(),
        exitAt: result.exitAt.toISOString(),
      },
      total: result.total,
      credited: result.credited,
    };
  }

  /**
   * Resumen del "turno" actual (para Caja). Como el sistema no tiene un modelo
   * de turnos/arqueo, se usa el día actual como turno y se agrupan los pagos
   * REALES registrados hoy (paidAt) por método: efectivo, tarjeta y abonos.
   */
  async getShiftSummary(): Promise<{
    scope: { from: string; to: string };
    currency: string;
    cash: { count: number; total: number };
    card: { count: number; total: number };
    credit: { count: number; total: number };
    totalCollected: number;
  }> {
    const from = startOfDay(new Date());
    const to = endOfDay(new Date());

    const rows = await this.paymentsRepository
      .createQueryBuilder('p')
      .select('p.method', 'method')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(p.amount), 0)', 'total')
      .where('p.status = :paid', { paid: PaymentStatus.PAID })
      .andWhere('p.paidAt >= :from AND p.paidAt <= :to', { from, to })
      .groupBy('p.method')
      .getRawMany<{ method: PaymentMethod; count: string; total: string }>();

    let cashCount = 0;
    let cashTotal = 0;
    let cardCount = 0;
    let cardTotal = 0;
    let creditCount = 0;
    let creditTotal = 0;

    for (const row of rows) {
      const count = Number(row.count) || 0;
      const total = Number(row.total) || 0;
      if (row.method === PaymentMethod.CASH) {
        cashCount = count;
        cashTotal = total;
      } else if (row.method === PaymentMethod.CARD) {
        cardCount = count;
        cardTotal = total;
      } else if (row.method === PaymentMethod.CREDIT) {
        creditCount = count;
        creditTotal = total;
      }
    }

    const totalCollected = round2(cashTotal + cardTotal + creditTotal);

    return {
      scope: { from: from.toISOString(), to: to.toISOString() },
      currency: await this.settingsCurrencyOrDefault(),
      cash: { count: cashCount, total: round2(cashTotal) },
      card: { count: cardCount, total: round2(cardTotal) },
      credit: { count: creditCount, total: round2(creditTotal) },
      totalCollected,
    };
  }

  private async settingsCurrencyOrDefault(): Promise<string> {
    const rows = await this.settingsRepository.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });
    return rows[0]?.currency ?? DEFAULT_CURRENCY;
  }
}
