import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { SettingsModule } from './settings/settings.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { PaymentsModule } from './payments/payments.module';
import { CashShiftsModule } from './cash-shifts/cash-shifts.module';
import { ReportsModule } from './reports/reports.module';
import { VisionModule } from './vision/vision.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        `.env.${process.env.NODE_ENV || 'development'}.local`,
        `.env.${process.env.NODE_ENV || 'development'}`,
        '.env.local',
        '.env',
      ],
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService): TypeOrmModuleOptions => {
        const databaseUrl = configService.get<string>('DATABASE_URL');
        const dbSsl = configService.get<string>('DB_SSL');
        let sslOption: boolean | { rejectUnauthorized: boolean } | undefined;
        if (dbSsl === 'true') {
          sslOption = { rejectUnauthorized: false };
        } else if (dbSsl === 'false') {
          sslOption = false;
        } else if (
          databaseUrl &&
          (databaseUrl.includes('sslmode=require') ||
            databaseUrl.includes('rlwy.net') ||
            databaseUrl.includes('railway.app'))
        ) {
          sslOption = { rejectUnauthorized: false };
        }

        const isProd =
          configService.get<string>('NODE_ENV', 'development') === 'production';
        const dbSync = configService.get<string>('DB_SYNC');
        const synchronize =
          dbSync === 'true' ? true : dbSync === 'false' ? false : !isProd;

        const baseOptions: TypeOrmModuleOptions = {
          type: 'postgres',
          autoLoadEntities: true,
          synchronize,
          // Railway puede arrancar el servicio antes de que Postgres esté
          // listo: se reintenta durante ~40s en vez de caer en el primer fallo.
          retryAttempts: 15,
          retryDelay: 3000,
          extra: {
            connectionTimeoutMillis: 10000,
            query_timeout: 15000,
            statement_timeout: 15000,
            max: 10,
          },
          ...(sslOption !== undefined ? { ssl: sslOption } : {}),
        };

        if (databaseUrl) {
          return {
            ...baseOptions,
            url: databaseUrl,
          };
        }

        const dbPort = Number(
          configService.get<string>('PGPORT') ||
            configService.get<string>('DB_PORT', '5432'),
        );

        return {
          ...baseOptions,
          host:
            configService.get<string>('PGHOST') ||
            configService.get<string>('DB_HOST', 'localhost'),
          port: dbPort,
          username:
            configService.get<string>('PGUSER') ||
            configService.get<string>('DB_USERNAME', 'postgres'),
          password:
            configService.get<string>('PGPASSWORD') ||
            configService.get<string>('DB_PASSWORD', 'postgres'),
          database:
            configService.get<string>('PGDATABASE') ||
            configService.get<string>('DB_DATABASE') ||
            configService.get<string>('DB_NAME', 'db_garaje'),
        };
      },
    }),

    UsersModule,
    AuthModule,
    SettingsModule,
    VehiclesModule,
    PaymentsModule,
    CashShiftsModule,
    ReportsModule,
    VisionModule,
    DatabaseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
