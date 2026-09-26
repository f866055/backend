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
        const sslOption =
          dbSsl === 'true'
            ? { rejectUnauthorized: false }
            : dbSsl === 'false'
              ? false
              : undefined;

        const baseOptions: TypeOrmModuleOptions = {
          type: 'postgres',
          autoLoadEntities: true,
          synchronize:
            configService.get<string>('NODE_ENV', 'development') !==
            'production',
          retryAttempts: 3,
          retryDelay: 1500,
          extra: {
            connectionTimeoutMillis: 5000,
            query_timeout: 10000,
            statement_timeout: 10000,
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
          configService.get<string>('DB_PORT', '5432'),
        );

        return {
          ...baseOptions,
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: dbPort,
          username: configService.get<string>('DB_USERNAME', 'postgres'),
          password: configService.get<string>('DB_PASSWORD', 'postgres'),
          database: configService.get<string>('DB_NAME', 'db_garaje'),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }