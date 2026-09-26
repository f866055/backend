import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class AppService {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  // Estado simple del sistema. Nunca expone credenciales, host ni usuario de BD.
  async getHealth(): Promise<{ status: string; database: string }> {
    let database = 'disconnected';
    try {
      await this.dataSource.query('SELECT 1');
      database = 'connected';
    } catch {
      // La consulta falla si PostgreSQL no está disponible; se informa sin detalles.
    }
    return {
      status: database === 'connected' ? 'ok' : 'degraded',
      database,
    };
  }
}
