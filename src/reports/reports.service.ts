import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vehicle, VEHICLE_TYPES } from '../vehicles/entities/vehicle.entity';
import { normalizePlate } from '../vehicles/plates.config';
import {
  EntryStatus,
  ParkingEntry,
} from '../vehicles/entities/parking-entry.entity';
import {
  Payment,
  PaymentMethod,
  PaymentStatus,
} from '../payments/entities/payment.entity';
import { GarageSetting } from '../settings/entities/garage-setting.entity';
import { GetReportsQueryDto } from './dto/get-reports-query.dto';

// Fallback coherente con SettingsService cuando aún no hay configuración.
const DEFAULT_TOTAL_SPACES = 40;
const DEFAULT_RATE_PER_HOUR = 2.0;
const DEFAULT_CURRENCY = 'PEN';

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Parsea una fecha asegurando inicio (00:00:00.000) o fin (23:59:59.999) del día
 * en la zona horaria local, evitando el desfase que produce new Date("YYYY-MM-DD")
 * al interpretar en UTC.
 */
function parseDateBoundary(
  value: string | Date | undefined,
  isEnd: boolean,
): Date {
  if (!value) {
    const d = new Date();
    if (isEnd) d.setHours(23, 59, 59, 999);
    else d.setHours(0, 0, 0, 0);
    return d;
  }
  if (value instanceof Date) {
    const d = new Date(value);
    if (isEnd) d.setHours(23, 59, 59, 999);
    else d.setHours(0, 0, 0, 0);
    return d;
  }
  const str = String(value).trim();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]) - 1;
    const day = Number(ymd[3]);
    const d = new Date(year, month, day);
    if (isEnd) d.setHours(23, 59, 59, 999);
    else d.setHours(0, 0, 0, 0);
    return d;
  }
  const d = new Date(str);
  if (isEnd) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

/** Inicio (00:00:00) de una fecha local. */
function startOfDay(value?: string | Date): Date {
  return parseDateBoundary(value, false);
}

/** Fin (23:59:59.999) de una fecha local. */
function endOfDay(value?: string | Date): Date {
  return parseDateBoundary(value, true);
}

export type PaymentStatusKind = 'pagado' | 'pendiente';

export interface ReportsTransaction {
  id: string;
  ticketCode: string;
  plate: string;
  vehicleType: string;
  entryAt: Date;
  exitAt: Date | null;
  durationMs: number;
  amount: number | null;
  method: PaymentMethod | null;
  status: string;
  statusKind: PaymentStatusKind;
}

export interface ReportsSummary {
  vehiclesAttended: number;
  vehiclesAttendedDelta: number | null;
  avgStayMs: number | null;
  avgStayNote: string | null;
  collectToday: number;
  currency: string;
  occupancyRate: number;
  occupancyNote: string;
  activeNow: number;
  totalSpaces: number;
}

export interface ReportsResponse {
  summary: ReportsSummary;
  transactions: ReportsTransaction[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface ReportsRow {
  id: string;
  ticketCode: string;
  plate: string;
  vehicleType: string;
  entryAt: Date;
  exitAt: Date | null;
  durationMs: number;
  amount: number | null;
  method: PaymentMethod | null;
  status: string;
  statusKind: PaymentStatusKind;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(ParkingEntry)
    private readonly entriesRepository: Repository<ParkingEntry>,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(GarageSetting)
    private readonly settingsRepository: Repository<GarageSetting>,
  ) {}

  private async settings() {
    const rows = await this.settingsRepository.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });
    return {
      totalSpaces: rows[0]?.totalSpaces ?? DEFAULT_TOTAL_SPACES,
      ratePerHour: Number.isFinite(Number(rows[0]?.ratePerHour))
        ? Number(rows[0]?.ratePerHour)
        : DEFAULT_RATE_PER_HOUR,
      currency: rows[0]?.currency ?? DEFAULT_CURRENCY,
    };
  }

  /**
   * Consulta principal de reportes. Los indicadores y las filas de la tabla
   * se calculan a partir de los datos reales (parking_entries + payments), sin
   * valores de demostración. Los "deltas" de las tarjetas comparan el periodo
   * actual con el anterior de igual duración; si no hay datos previos, se
   * omiten (nunca se inventan).
   */
  async getReports(query: GetReportsQueryDto) {
    const now = await this.settings();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;

    // Rango de fechas: si no se indica, se consulta el día actual.
    const from = startOfDay(query.dateFrom);
    const to = endOfDay(query.dateTo);

    const [rows, total] = await this.queryEntries(
      { from, to, ...query },
      page,
      pageSize,
    );

    const paymentByEntry = await this.loadPaymentsFor(rows);
    const transactions = rows.map((entry) => this.toRow(entry, paymentByEntry));

    // --- Indicadores (siempre desde datos reales) ---
    const summary = await this.computeSummary(
      from,
      to,
      paymentByEntry,
      now.totalSpaces,
      now.currency,
    );

    return {
      summary,
      transactions,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /** Filas + conteo total dentro del rango y filtros. */
  private async queryEntries(
    filters: { from: Date; to: Date } & Pick<
      GetReportsQueryDto,
      'vehicleType' | 'plate' | 'paymentStatus' | 'search'
    >,
    page: number,
    pageSize: number,
  ): Promise<[ParkingEntry[], number]> {
    const qb = this.entriesRepository
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.vehicle', 'v')
      .where('e.entryAt >= :from AND e.entryAt <= :to', {
        from: filters.from,
        to: filters.to,
      });

    if (
      filters.vehicleType &&
      VEHICLE_TYPES.includes(filters.vehicleType as never)
    ) {
      qb.andWhere('v.type = :vehicleType', {
        vehicleType: filters.vehicleType,
      });
    }

    if (filters.plate && filters.plate.trim()) {
      const plateTerm = normalizePlate(filters.plate).toUpperCase();
      qb.andWhere('v.plateNormalized ILIKE :plate', {
        plate: `%${plateTerm}%`,
      });
    }

    if (filters.search && filters.search.trim()) {
      const rawTerm = filters.search.trim().toUpperCase();
      // Término normalizado (sin espacios/guiones) para coincidir con
      // plateNormalized: así "QER567" y "QER-567" encuentran el mismo registro.
      const normTerm = normalizePlate(rawTerm).toUpperCase();
      const searchTerm = `%${rawTerm}%`;
      const normSearchTerm = `%${normTerm}%`;
      qb.andWhere(
        '(v.plateNormalized ILIKE :normTerm OR e.ticketCode ILIKE :searchTerm)',
        {
          normTerm: normSearchTerm,
          searchTerm,
        },
      );
    }

    if (filters.paymentStatus === 'paid') {
      qb.andWhere(
        'e.status = :finalizado AND EXISTS (SELECT 1 FROM payments p WHERE p.parking_entry_id = e.id)',
        { finalizado: EntryStatus.FINALIZADO },
      );
    } else if (filters.paymentStatus === 'pending') {
      qb.andWhere(
        '(e.status <> :finalizado OR NOT EXISTS (SELECT 1 FROM payments p WHERE p.parking_entry_id = e.id))',
        { finalizado: EntryStatus.FINALIZADO },
      );
    }

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('e.entryAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return [rows, total];
  }

  private async loadPaymentsFor(
    entries: ParkingEntry[],
  ): Promise<Map<string, Payment>> {
    if (entries.length === 0) return new Map();
    const ids = entries.map((e) => e.id);
    const payments = await this.paymentsRepository
      .createQueryBuilder('p')
      .where('p.entryId IN (:...ids)', { ids })
      .getMany();
    const map = new Map<string, Payment>();
    for (const p of payments) {
      const existing = map.get(p.entryId);
      // Prioriza el pago FINAL (cash/card) sobre los abonos (credit): si un
      // ticket abonado se pagó al salir, el método mostrado es el del cierre.
      if (
        !existing ||
        (existing.method === PaymentMethod.CREDIT &&
          p.method !== PaymentMethod.CREDIT)
      ) {
        map.set(p.entryId, p);
      }
    }
    return map;
  }

  private toRow(
    entry: ParkingEntry,
    paymentByEntry: Map<string, Payment>,
  ): ReportsRow {
    const payment = paymentByEntry.get(entry.id) ?? null;
    const vehicle: Vehicle = entry.vehicle;
    const isInside = entry.status === EntryStatus.ACTIVO || !entry.exitAt;

    let amount: number | null = null;
    let method: PaymentMethod | null = null;
    let status: string;
    let statusKind: PaymentStatusKind;

    if (isInside) {
      status = 'En estacionamiento';
      statusKind = 'pendiente';
    } else if (payment && payment.status === PaymentStatus.PAID) {
      amount = Number(payment.amount);
      method = payment.method;
      status = 'Pagado';
      statusKind = 'pagado';
    } else {
      status = 'Pendiente';
      statusKind = 'pendiente';
    }

    const exit = isInside ? null : entry.exitAt;
    // Para vehículos aún dentro, la duración es el tiempo real transcurrido
    // desde el ingreso (sin inventar una hora de salida).
    const durationMs = exit
      ? Math.max(0, exit.getTime() - entry.entryAt.getTime())
      : Math.max(0, new Date().getTime() - entry.entryAt.getTime());

    return {
      id: entry.id,
      ticketCode: entry.ticketCode,
      plate: vehicle.plate,
      vehicleType: vehicle.type,
      entryAt: entry.entryAt,
      exitAt: exit,
      durationMs,
      amount,
      method,
      status,
      statusKind,
    };
  }

  /**
   * Indicadores de las tarjetas. Todos se derivan de datos reales; si no hay
   * periodo previo para comparar, los deltas/notas se omiten (null).
   */
  private async computeSummary(
    from: Date,
    to: Date,
    paymentByEntry: Map<string, Payment>,
    totalSpaces: number,
    currency: string,
  ) {
    const ms = Math.max(1, to.getTime() - from.getTime() + 1);
    const prevEnd = new Date(from.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - ms + 1);

    // Vehículos atendidos en el periodo (ingresos registrados).
    const vehiclesAttended = await this.entriesRepository
      .createQueryBuilder('e')
      .where('e.entryAt >= :from AND e.entryAt <= :to', { from, to })
      .getCount();
    const vehiclesPrev = await this.entriesRepository
      .createQueryBuilder('e')
      .where('e.entryAt >= :from AND e.entryAt <= :to', {
        from: prevStart,
        to: prevEnd,
      })
      .getCount();

    // Duración promedio de las estancias finalizadas del periodo.
    const { avg: avgRaw } = (await this.entriesRepository
      .createQueryBuilder('e')
      .select(
        'AVG(EXTRACT(EPOCH FROM (e.fecha_salida - e.fecha_ingreso)) * 1000)',
        'avg',
      )
      .where('e.status = :finalizado', { finalizado: EntryStatus.FINALIZADO })
      .andWhere('e.entryAt >= :from AND e.entryAt <= :to', { from, to })
      .getRawOne()) as { avg: string | null };
    const { avg: avgPrevRaw } = (await this.entriesRepository
      .createQueryBuilder('e')
      .select(
        'AVG(EXTRACT(EPOCH FROM (e.fecha_salida - e.fecha_ingreso)) * 1000)',
        'avg',
      )
      .where('e.status = :finalizado', { finalizado: EntryStatus.FINALIZADO })
      .andWhere('e.entryAt >= :from AND e.entryAt <= :to', {
        from: prevStart,
        to: prevEnd,
      })
      .getRawOne()) as { avg: string | null };

    const avgStayMsNum = avgRaw !== null ? Number(avgRaw) : null;
    const avgPrevMsNum = avgPrevRaw !== null ? Number(avgPrevRaw) : null;

    // Recaudación del periodo (suma de pagos registrados en el rango).
    const collect = await this.paymentsRepository
      .createQueryBuilder('p')
      .select('COALESCE(SUM(p.amount), 0)', 'total')
      .where('p.status = :paid', { paid: PaymentStatus.PAID })
      .andWhere('p.paidAt >= :from AND p.paidAt <= :to', { from, to })
      .getRawOne<{ total: string }>();
    const collectToday = round2(Number(collect?.total ?? 0));

    // Ocupación actual (no depende del rango de fechas).
    const active = await this.entriesRepository
      .createQueryBuilder('e')
      .where('e.status = :activo', { activo: EntryStatus.ACTIVO })
      .getCount();
    const occupancyRate =
      totalSpaces > 0 ? Math.min((active / totalSpaces) * 100, 100) : 0;

    // Notas / deltas calculados (null cuando no hay con qué comparar).
    const pct = (cur: number, prev: number): number | null => {
      if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0)
        return null;
      return round2(((cur - prev) / prev) * 100);
    };

    const vehiclesAttendedDelta = pct(vehiclesAttended, vehiclesPrev);
    const avgStayDelta =
      avgStayMsNum !== null && avgPrevMsNum !== null
        ? pct(avgStayMsNum, avgPrevMsNum)
        : null;

    const avgStayNote =
      avgStayMsNum !== null && avgPrevMsNum !== null && avgStayMsNum > 0
        ? Math.abs(avgStayDelta ?? 0) < 5
          ? 'Estable'
          : `${avgStayDelta! > 0 ? '+' : ''}${avgStayDelta}%`
        : null;

    const occupancyNote =
      occupancyRate >= 90
        ? 'Cerca del límite'
        : occupancyRate >= 75
          ? 'Ocupación alta'
          : 'Ocupación normal';

    return {
      vehiclesAttended,
      vehiclesAttendedDelta,
      avgStayMs: avgStayMsNum,
      avgStayNote,
      collectToday,
      currency,
      occupancyRate: Math.round(occupancyRate),
      occupancyNote,
      activeNow: active,
      totalSpaces,
    };
  }
}
