import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { GarageSetting } from '../settings/entities/garage-setting.entity';
import { Role } from '../auth/enums/role.enum';
import { Vehicle } from './entities/vehicle.entity';
import { EntryStatus, ParkingEntry } from './entities/parking-entry.entity';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { User } from '../users/entities/user.entity';
import { AuthUser } from '../auth/current-user.decorator';
import {
  isValidNormalizedLength,
  normalizePlate,
  PLATE_MAX_LENGTH,
  PLATE_MIN_LENGTH,
} from './plates.config';


// Fallback coherente con SettingsService cuando aún no hay configuración.
const DEFAULT_TOTAL_SPACES = 40;

/** Códigos estructurados para que el frontend distinga el tipo de conflicto. */
export type VehicleConflictCode =
  'PLATE_ALREADY_REGISTERED' | 'VEHICLE_ALREADY_INSIDE' | 'GARAGE_FULL';

// Código de ticket legible y prácticamente único (ej. TK-LZK3F2A9).
function generateTicketCode(): string {
  const time = Date.now().toString(36).toUpperCase();
  const random = Math.floor(Math.random() * 1296)
    .toString(36)
    .toUpperCase()
    .padStart(2, '0');
  return `TK-${time}${random}`;
}

export interface EntryAttemptOptions {
  /** Solicita forzar el ingreso con garaje lleno; SOLO surte efecto si role es ADMIN. */
  force?: boolean;
  /** Rol del usuario autenticado (para autorizar el force). */
  role?: Role | null;
  /** Usuario autenticado que ejecuta la operación (persistido como operador). */
  operator?: AuthUser | null;
}

/** Nombre legible de un operador a partir de su perfil (sin duplicados). */
export function formatOperatorName(
  user: Pick<User, 'name' | 'lastname'> | null | undefined,
): string {
  if (!user) return '';
  return `${user.name} ${user.lastname}`.trim();
}

@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly vehiclesRepository: Repository<Vehicle>,
    @InjectRepository(ParkingEntry)
    private readonly entriesRepository: Repository<ParkingEntry>,
    @InjectRepository(GarageSetting)
    private readonly settingsRepository: Repository<GarageSetting>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) { }

  private conflict(
    code: VehicleConflictCode,
    message: string,
  ): ConflictException {
    // Al pasar un objeto, NestJS lo devuelve como cuerpo tal cual: el frontend
    // puede leer `code` además de `message`.
    return new ConflictException({ code, message });
  }

  private assertNormalizedPlate(normalized: string): void {
    if (!isValidNormalizedLength(normalized)) {
      throw new BadRequestException(
        `La placa debe tener entre ${PLATE_MIN_LENGTH} y ${PLATE_MAX_LENGTH} caracteres alfanuméricos (sin espacios ni guiones)`,
      );
    }
  }

  private isAdmin(role?: Role | null): boolean {
    return role === Role.ADMIN;
  }

  /**
   * Normaliza (insensible a mayúsculas/guiones/espacios/puntos) y busca por la
   * clave canónica plate_normalized. Incluye el ingreso activo si existe para
   * que el frontend muestre el detalle del duplicado sin otra llamada.
   */
  async findByPlate(plate: string): Promise<
    Vehicle & {
      isInsideGarage: boolean;
      activeEntry:
      | (Pick<ParkingEntry, 'id' | 'ticketCode' | 'entryAt'> & {
        operatorName: string;
      })
      | null;
    }
  > {
    const normalized = normalizePlate(plate);
    this.assertNormalizedPlate(normalized);

    const vehicle = await this.vehiclesRepository.findOne({
      where: { plateNormalized: normalized },
    });
    if (!vehicle) {
      throw new NotFoundException('Vehículo no encontrado en base de datos');
    }

    const activeEntry = await this.entriesRepository.findOne({
      where: { vehicleId: vehicle.id, status: EntryStatus.ACTIVO },
      order: { entryAt: 'DESC' },
      select: { id: true, ticketCode: true, entryAt: true },
      relations: { createdBy: true },
    });

    return {
      ...vehicle,
      isInsideGarage: !!activeEntry,
      activeEntry: activeEntry
        ? {
          id: activeEntry.id,
          ticketCode: activeEntry.ticketCode,
          entryAt: activeEntry.entryAt,
          operatorName: formatOperatorName(activeEntry.createdBy),
        }
        : null,
    };
  }

  /**
   * Flujo "Registrar Vehículo e Ingresar": crea el vehículo Y su ticket de
   * ingreso en una sola transacción, para que nunca quede un vehículo sin
   * ingreso (o viceversa) ante un fallo a mitad de operación. La capacidad se
   * verifica DENTRO de la transacción; un ADMIN puede forzarla con force=true.
   */
  async createVehicleWithEntry(
    dto: CreateVehicleDto,
    options: EntryAttemptOptions = {},
  ): Promise<{ vehicle: Vehicle; entry: ParkingEntry; operatorName: string }> {
    const normalized = normalizePlate(dto.plate);
    this.assertNormalizedPlate(normalized);
    // Placa no peruana NO rechaza: solo queda registrada tal cual (advertencia en UI).

    const existing = await this.vehiclesRepository.findOne({
      where: { plateNormalized: normalized },
    });
    if (existing) {
      throw this.conflict(
        'PLATE_ALREADY_REGISTERED',
        'Ya existe un vehículo registrado con esta placa',
      );
    }

    const rawText = dto.plateRaw?.trim() || dto.plate.trim();

    // Operador que ejecuta la operación: se resuelve desde el usuario
    // autenticado y se persiste en el ticket (createdById).
    const operator = options.operator?.id
      ? await this.usersRepository.findOne({
        where: { id: options.operator.id },
      })
      : null;

    return this.dataSource.transaction(async (manager) => {
      await this.assertCapacityInsideTransaction(manager, {
        force: !!options.force && this.isAdmin(options.role),
      });

      const vehicle = await manager.getRepository(Vehicle).save({
        plate: dto.plate.trim(),
        plateNormalized: normalized,
        plateRaw: rawText,
        brand: dto.brand?.trim() || null,
        model: dto.model?.trim() || null,
        color: dto.color?.trim() || null,
        type: dto.type as Vehicle['type'],
        ownerName: dto.ownerName?.trim() || null,
        phone: dto.phone?.trim() || null,
        observation: dto.observation?.trim() || null,
      });

      const entry = await manager.getRepository(ParkingEntry).save({
        ticketCode: generateTicketCode(),
        vehicleId: vehicle.id,
        status: EntryStatus.ACTIVO,
        createdById: operator?.id ?? null,
      });

      return { vehicle, entry, operatorName: formatOperatorName(operator) };
    });
  }

  /**
   * Registra el ingreso (ticket) de un vehículo ya existente. Todo ocurre en
   * UNA transacción: lock pesimista de la fila del vehículo → re-chequeo de
   * duplicado → capacidad → insert. Así dos ingresos concurrentes nunca
   * generan doble ticket ni superan la capacidad.
   */
  async registerEntry(
    plate: string,
    options: EntryAttemptOptions = {},
  ): Promise<{ vehicle: Vehicle; entry: ParkingEntry; operatorName: string }> {
    const normalized = normalizePlate(plate);
    this.assertNormalizedPlate(normalized);

    const operator = options.operator?.id
      ? await this.usersRepository.findOne({
        where: { id: options.operator.id },
      })
      : null;

    return this.dataSource.transaction(async (manager) => {
      // Lock de fila: serializa intentos simultáneos sobre el mismo vehículo.
      const vehicle = await manager
        .getRepository(Vehicle)
        .findOne({ where: { plateNormalized: normalized } });
      if (!vehicle) {
        throw new NotFoundException('Vehículo no encontrado en base de datos');
      }

      if (
        await manager.getRepository(ParkingEntry).count({
          where: { vehicleId: vehicle.id, status: EntryStatus.ACTIVO },
        })
      ) {
        throw this.conflict(
          'VEHICLE_ALREADY_INSIDE',
          'El vehículo ya se encuentra dentro del garaje',
        );
      }

      await this.assertCapacityInsideTransaction(manager, {
        force: !!options.force && this.isAdmin(options.role),
      });

      const entry = await manager.getRepository(ParkingEntry).save({
        ticketCode: generateTicketCode(),
        vehicleId: vehicle.id,
        status: EntryStatus.ACTIVO,
        createdById: operator?.id ?? null,
      });

      return { vehicle, entry, operatorName: formatOperatorName(operator) };
    });
  }

  /** Ingresos activos (vehículos dentro ahora mismo), del más reciente al más antiguo. */
  async getActiveEntries(): Promise<
    Array<ParkingEntry & { operatorName: string }>
  > {
    const entries = await this.entriesRepository.find({
      where: { status: EntryStatus.ACTIVO },
      relations: { vehicle: true, createdBy: true },
      order: { entryAt: 'DESC' },
    });
    // Exponer solo el nombre del operador, nunca el objeto User completo.
    return entries.map((e) => ({
      ...e,
      operatorName: formatOperatorName(e.createdBy),
    }));
  }

  /*
    Capacidad verificada dentro de la transacción del registro. Con force=true
    (exclusivo ADMIN) se omite el tope para permitir el ingreso forzado.
  */
  private async assertCapacityInsideTransaction(
    manager: EntityManager,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    if (opts.force) return;

    const [occupied, total] = await Promise.all([
      manager
        .getRepository(ParkingEntry)
        .count({ where: { status: EntryStatus.ACTIVO } }),
      (async () => {
        const rows = await manager.getRepository(GarageSetting).find({
          order: { createdAt: 'ASC' },
          take: 1,
        });
        return rows[0]?.totalSpaces ?? DEFAULT_TOTAL_SPACES;
      })(),
    ]);
    if (occupied >= total) {
      throw this.conflict(
        'GARAGE_FULL',
        `El garaje está lleno (${occupied}/${total} espacios ocupados)`,
      );
    }
  }
}
