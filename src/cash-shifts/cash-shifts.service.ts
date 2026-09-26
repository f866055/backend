import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Payment, PaymentMethod } from '../payments/entities/payment.entity';
import { User } from '../users/entities/user.entity';
import { GarageSetting } from '../settings/entities/garage-setting.entity';
import { OpenCashShiftDto } from './dto/open-cash-shift.dto';
import {
  CashShift,
  CashShiftStatus,
} from './entities/cash-shift.entity';

const DEFAULT_CURRENCY = 'PEN';

// 2 decimales fijos; evita errores de punto flotante al resumir.
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const asNumber = (value: string | number | null | undefined): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export interface ShiftCollectionSummary {
  shift: {
    id: string;
    status: 'open' | 'closed';
    openedById: string;
    operatorName: string;
    openedAt: string;
    closedAt: string | null;
    openingFund: number;
  } | null;
  hasOpen: boolean;
  currency: string;
  totals: Record<
    'cash' | 'yape' | 'plin' | 'card' | 'transfer',
    { count: number; total: number }
  >;
  credits: { count: number; total: number };
  totalCollected: number;
  operationsCount: number;
}

@Injectable()
export class CashShiftsService {
  constructor(
    @InjectRepository(CashShift)
    private readonly shiftsRepository: Repository<CashShift>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(GarageSetting)
    private readonly settingsRepository: Repository<GarageSetting>,
    private readonly dataSource: DataSource,
  ) {}

  /** Caja ABIERTA actualmente, o null si no hay turno vivo. */
  async getOpenShift(): Promise<CashShift | null> {
    return this.shiftsRepository.findOne({
      where: { status: CashShiftStatus.OPEN },
      order: { openedAt: 'DESC' },
    });
  }

  /**
   * Turno vigente para la pantalla de Caja. Devolvemos la caja abierta actual
   * si existe; si no, el turno más reciente (permite mostrar el último cierre).
   * No lanza si nunca se abrió caja: el frontend muestra el estado desocupado.
   */
  async current() {
    const open = await this.getOpenShift();
    let shift = open;
    if (!shift) {
      const recent = await this.shiftsRepository.find({
        order: { openedAt: 'DESC' },
        take: 1,
      });
      shift = recent[0] ?? null;
    }

    return this.summarize(shift, !!open);
  }

  async shiftCollection(
    shift: CashShift,
  ): Promise<ShiftCollectionSummary> {
    return this.summarize(shift, shift.status === CashShiftStatus.OPEN);
  }

  /** Resumen de un turno concreto (para el panel tras abrir/cerrar). */
  async getShiftById(id: string) {
    const shift = await this.shiftsRepository.findOneBy({ id });
    if (!shift) {
      throw new NotFoundException('Turno no encontrado');
    }
    return this.summarize(shift, shift.status === CashShiftStatus.OPEN);
  }

  /** Lista de turnos (abiertos y cerrados) con operador y recaudación para el desglose lateral */
  async findAll(limit = 50) {
    const shifts = await this.shiftsRepository.find({
      relations: { openedBy: true },
      order: { openedAt: 'DESC' },
      take: limit,
    });

    const shiftIds = shifts.map((s) => s.id);
    let totalsMap = new Map<string, { total: number; count: number }>();

    if (shiftIds.length > 0) {
      const rows = await this.dataSource
        .getRepository(Payment)
        .createQueryBuilder('p')
        .select('p.cashShiftId', 'shiftId')
        .addSelect('COALESCE(SUM(p.amount), 0)', 'total')
        .addSelect('COUNT(*)', 'count')
        .where('p.cashShiftId IN (:...shiftIds)', { shiftIds })
        .andWhere('p.status = :paid', { paid: 'paid' })
        .groupBy('p.cashShiftId')
        .getRawMany<{ shiftId: string; total: string; count: string }>();

      totalsMap = new Map(
        rows.map((r) => [
          r.shiftId,
          { total: round2(asNumber(r.total)), count: Number(r.count) || 0 },
        ]),
      );
    }

    const currency = await this.settingsCurrencyOrDefault();

    return shifts.map((s) => {
      const stats = totalsMap.get(s.id) ?? { total: 0, count: 0 };
      const operatorName = s.openedBy
        ? `${s.openedBy.name ?? ''} ${s.openedBy.lastname ?? ''}`.trim()
        : 'Desconocido';

      return {
        id: s.id,
        status: s.status,
        openedById: s.openedById,
        operatorName: operatorName || 'Desconocido',
        openingFund: asNumber(s.openingFund),
        openedAt: s.openedAt ? s.openedAt.toISOString() : null,
        closedAt: s.closedAt ? s.closedAt.toISOString() : null,
        totalCollected: stats.total,
        operationsCount: stats.count,
        currency,
      };
    });
  }

  /** Construye el resumen del turno (o vacío si nunca hubo turno). */
  private async summarize(
    shift: CashShift | null,
    hasOpen: boolean,
  ): Promise<{
    shift: ShiftCollectionSummary['shift'] | null;
    hasOpen: boolean;
    totals: ShiftCollectionSummary['totals'];
    credits: ShiftCollectionSummary['credits'];
    totalCollected: number;
    operationsCount: number;
    currency: string;
  }> {
    const empty = () => ({ count: 0, total: 0 });
    const emptyTotals = {
      cash: empty(),
      yape: empty(),
      plin: empty(),
      card: empty(),
      transfer: empty(),
    };

    if (!shift) {
      return {
        shift: null,
        hasOpen,
        totals: emptyTotals,
        credits: empty(),
        totalCollected: 0,
        operationsCount: 0,
        currency: await this.settingsCurrencyOrDefault(),
      };
    }

    const operator = await this.usersRepository.findOneBy({
      id: shift.openedById,
    });

    const rows = await this.dataSource
      .getRepository(Payment)
      .createQueryBuilder('p')
      .select('p.method', 'method')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(p.amount), 0)', 'total')
      .where('p.cashShiftId = :shiftId', { shiftId: shift.id })
      .andWhere('p.status = :paid', { paid: 'paid' })
      .groupBy('p.method')
      .getRawMany<{ method: PaymentMethod; count: string; total: string }>();

    const totals = { ...emptyTotals };
    let credits = empty();

    for (const row of rows) {
      const entry = {
        count: Number(row.count) || 0,
        total: round2(asNumber(row.total)),
      };
      const method = row.method;
      if (method === PaymentMethod.CREDIT) {
        credits = entry;
      } else if (method in totals) {
        totals[method as keyof typeof totals] = entry;
      }
    }

    const totalCollected = round2(
      totals.cash.total +
        totals.yape.total +
        totals.plin.total +
        totals.card.total +
        totals.transfer.total +
        credits.total,
    );
    const operationsCount = rows.reduce(
      (sum, row) => sum + (Number(row.count) || 0),
      0,
    );

    return {
      shift: {
        id: shift.id,
        status: shift.status,
        openedById: shift.openedById,
        operatorName:
          `${operator?.name ?? ''} ${operator?.lastname ?? ''}`.trim(),
        openedAt: shift.openedAt.toISOString(),
        closedAt: shift.closedAt ? shift.closedAt.toISOString() : null,
        openingFund: asNumber(shift.openingFund),
      },
      hasOpen,
      totals,
      credits,
      totalCollected,
      operationsCount,
      currency: await this.settingsCurrencyOrDefault(),
    };
  }

  /**
   * Abre una caja nueva. Telón de seguridad: usa un advisory lock para que
   * nunca existan dos cajas abiertas al mismo tiempo (aun con doble clic o
   * dos cajeros). Valida que no haya una caja ABIERTA previa.
   */
  async openShift(
    dto: OpenCashShiftDto,
    userId: string,
  ): Promise<ShiftCollectionSummary> {
    const openingFund = Math.max(
      0,
      Number.isFinite(dto.openingFund) ? round2(dto.openingFund!) : 0,
    );

    const shift = await this.dataSource.transaction(async (manager) => {
      // Advisory lock: serializa aperturas concurrentes a nivel de sesión BD.
      await manager.query('SELECT pg_advisory_xact_lock($1)', [
        9_001_991_000,
      ]);

      const open = await manager.getRepository(CashShift).findOne({
        where: { status: CashShiftStatus.OPEN },
        order: { openedAt: 'DESC' },
      });
      if (open) {
        throw new ConflictException(
          'Ya existe una caja abierta. Ciérrala antes de abrir una nueva.',
        );
      }

      return manager.getRepository(CashShift).save({
        status: CashShiftStatus.OPEN,
        openedById: userId,
        openingFund: String(openingFund),
        openedAt: new Date(),
        closedAt: null,
      });
    });

    return this.shiftCollection(shift);
  }

  /**
   * Cierra la caja abierta actual: fija status CLOSED y closedAt. Exige que el
   * turno indicado sea exactamente el que está abierto (evita cerrar un turno
   * ajeno desde otra terminal).
   */
  async closeShift(shiftId: string): Promise<ShiftCollectionSummary> {
    const shift = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [
        9_001_991_000,
      ]);

      const open = await manager.getRepository(CashShift).findOne({
        where: { status: CashShiftStatus.OPEN },
        order: { openedAt: 'DESC' },
      });
      if (!open) {
        throw new ConflictException('No hay una caja abierta para cerrar.');
      }
      if (open.id !== shiftId) {
        throw new ConflictException(
          'El turno a cerrar no es la caja abierta actual.',
        );
      }

      open.status = CashShiftStatus.CLOSED;
      open.closedAt = new Date();
      return manager.getRepository(CashShift).save(open);
    });

    return this.shiftCollection(shift);
  }

  private async settingsCurrencyOrDefault(): Promise<string> {
    const rows = await this.settingsRepository.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });
    return rows[0]?.currency ?? DEFAULT_CURRENCY;
  }
}