import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega a `garage_settings` la columna `ratePerHour` (tarifa por hora usada al
 * cobrar una salida) y crea la tabla `payments` (pagos de tickets de salida).
 *
 * No destructiva: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS. En
 * desarrollo TypeORM corre con synchronize:true y podría crear la columna o la
 * tabla antes de que corra esta migración, por eso todo es idempotente.
 */
export class AddRatePerHourAndPayments1788000000000 implements MigrationInterface {
  name = 'AddRatePerHourAndPayments1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Tarifa por hora (NUMERIC para dinero exacto, no FLOAT).
    await queryRunner.query(
      `ALTER TABLE "garage_settings" ADD COLUMN IF NOT EXISTS "ratePerHour" numeric(10,2) DEFAULT 2.00`,
    );

    // 2. Enums de pago (if not exists, idempotente ante synchronize).
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payments_method_enum') THEN
           CREATE TYPE "payments_method_enum" AS ENUM ('cash', 'card');
         END IF;
       END $$`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payments_status_enum') THEN
           CREATE TYPE "payments_status_enum" AS ENUM ('paid', 'failed', 'cancelled');
         END IF;
       END $$`,
    );

    // 3. Tabla de pagos. FK a parking_entries (ticket de ingreso que se cierra).
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "payments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "parking_entry_id" uuid NOT NULL,
        "ticket_code" varchar(20) NOT NULL,
        "amount" numeric(10,2) NOT NULL,
        "method" "payments_method_enum" NOT NULL,
        "amount_received" numeric(10,2),
        "change_amount" numeric(10,2),
        "status" "payments_status_enum" NOT NULL DEFAULT 'paid',
        "paid_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_payments" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT IF NOT EXISTS "fk_payments_parking_entry" FOREIGN KEY ("parking_entry_id") REFERENCES "parking_entries"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_payments_parking_entry" ON "payments" ("parking_entry_id")`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Reversión intencionalmente vacía: nunca eliminamos datos ni estructuras.
  }
}
