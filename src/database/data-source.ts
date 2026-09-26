import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { CreateGarageSettings1769000000000 } from './migrations/1769000000000-create-garage-settings';
import { AddVehiclePlateNormalized1787500000000 } from './migrations/1787500000000-add-vehicle-plate-normalized';
import { AddRatePerHourAndPayments1788000000000 } from './migrations/1788000000000-add-rate-per-hour-and-payments';
import { AddEntryOperator1789000000000 } from './migrations/1789000000000-add-entry-operator';
import { AddCreditPaymentMethod1790000000000 } from './migrations/1790000000000-add-credit-payment-method';
import { CreateCashShiftsAndPaymentMethods1791000000000 } from './migrations/1791000000000-create-cash-shifts-and-payment-methods';
import { VehicleTypesAndObservation1792000000000 } from './migrations/1792000000000-vehicle-types-and-observation';

// Data Source para el CLI de migraciones de TypeORM.
// Espea la configuración de app.module.ts (env-driven, sin secretos en el código).
const databaseUrl = process.env.DATABASE_URL;

export default new DataSource(
  databaseUrl
    ? {
        type: 'postgres',
        url: databaseUrl,
        ssl:
          process.env.DB_SSL === 'true' ||
          databaseUrl.includes('rlwy.net') ||
          databaseUrl.includes('sslmode=require')
            ? { rejectUnauthorized: false }
            : false,
        entities: ['dist/**/*.entity.js'],
        migrations: [
          CreateGarageSettings1769000000000,
          AddVehiclePlateNormalized1787500000000,
          AddRatePerHourAndPayments1788000000000,
          AddEntryOperator1789000000000,
          AddCreditPaymentMethod1790000000000,
          CreateCashShiftsAndPaymentMethods1791000000000,
          VehicleTypesAndObservation1792000000000,
        ],
      }
    : {
        type: 'postgres',
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        username: process.env.DB_USERNAME ?? 'postgres',
        password: process.env.DB_PASSWORD ?? '',
        database: process.env.DB_NAME ?? 'db_garaje',
        entities: ['dist/**/*.entity.js'],
        migrations: [
          CreateGarageSettings1769000000000,
          AddVehiclePlateNormalized1787500000000,
          AddRatePerHourAndPayments1788000000000,
          AddEntryOperator1789000000000,
          AddCreditPaymentMethod1790000000000,
          CreateCashShiftsAndPaymentMethods1791000000000,
          VehicleTypesAndObservation1792000000000,
        ],
      },
);
