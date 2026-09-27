import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

/**
 * En producción TypeORM corre con `synchronize: false` (Railway no debe
 * modificar el esquema en cada arranque), pero una base recién creada está
 * vacía y todas las consultas fallarían con "relation does not exist".
 *
 * Este servicio crea el esquema únicamente cuando falta alguna tabla, antes de
 * que el servidor acepte peticiones. Es idempotente y no toca bases que ya
 * tienen el esquema instalado.
 */
@Injectable()
export class DatabaseBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseBootstrapService.name);
  private ready: Promise<void> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  onApplicationBootstrap(): Promise<void> {
    return this.ensureSchema();
  }

  ensureSchema(): Promise<void> {
    this.ready ??= this.run();
    return this.ready;
  }

  private async run(): Promise<void> {
    const dbSync = this.configService.get<string>('DB_SYNC');
    if (dbSync === 'true' || dbSync === 'false') {
      // La decisión ya la tomó TypeORM al conectar (app.module.ts).
      return;
    }

    const isProd =
      this.configService.get<string>('NODE_ENV', 'development') ===
      'production';
    if (!isProd) {
      return;
    }

    const expectedTables = this.dataSource.entityMetadatas.map(
      (metadata) => metadata.tableName,
    );
    if (expectedTables.length === 0) {
      return;
    }

    const rows = await this.dataSource.query<
      Array<{ name: string; present: boolean }>
    >(
      `SELECT name, to_regclass('public.' || name) IS NOT NULL AS present
         FROM unnest($1::text[]) AS name`,
      [expectedTables],
    );
    const missing = rows.filter((row) => !row.present).map((row) => row.name);
    if (missing.length === 0) {
      return;
    }

    this.logger.warn(
      `Faltan tablas en la base de datos (${missing.join(', ')}): se creará el esquema a partir de las entidades.`,
    );
    await this.dataSource.synchronize();
    this.logger.log('Esquema de base de datos creado correctamente.');
  }
}
