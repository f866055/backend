import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Crea la tabla `cash_shifts` (turnos de caja: apertura/cierre, cajero y fondo
 * inicial) y amplía el enum de métodos de pago con `yape`, `plin` y `transfer`.
 *
 * Idempotente: CREATE TABLE IF NOT EXISTS / ADD VALUE IF NOT EXISTS. En
 * desarrollo TypeORM corre con synchronize:true y podría crear la tabla o el
 * enum antes de que corra esta migración, por eso nada es destructivo.
 */
export class CreateCashShiftsAndPaymentMethods1791000000000
  implements MigrationInterface
{
  name = 'CreateCashShiftsAndPaymentMethods1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Estado del turno: abierto / cerrado.
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cash_shifts_status_enum') THEN
           CREATE TYPE "cash_shifts_status_enum" AS ENUM ('open', 'closed');
         END IF;
       END $$`,
    );

    // 2. Tabla de turnos/cajas. FK a users (cajero que abrió).
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "cash_shifts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "status" "cash_shifts_status_enum" NOT NULL DEFAULT 'open',
        "opened_by_id" uuid NOT NULL,
        "opening_fund" numeric(10,2) NOT NULL DEFAULT 0,
        "opened_at" timestamptz NOT NULL DEFAULT now(),
        "closed_at" timestamptz,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_cash_shifts" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cash_shifts_opened_by') THEN
           ALTER TABLE "cash_shifts" ADD CONSTRAINT "fk_cash_shifts_opened_by" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;
         END IF;
       END $$`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_cash_shifts_status" ON "cash_shifts" ("status")`,
    );

    // 3. Métodos de pago: yape, plin y transferencia (además de cash/card/credit).
    await queryRunner.query(
      `DO $$ BEGIN
         IF EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_type.oid = pg_enum.enumtypid WHERE pg_type.typname = 'payments_method_enum' AND pg_enum.enumlabel = 'cash') THEN
           ALTER TYPE "payments_method_enum" ADD VALUE IF NOT EXISTS 'yape';
           ALTER TYPE "payments_method_enum" ADD VALUE IF NOT EXISTS 'plin';
           ALTER TYPE "payments_method_enum" ADD VALUE IF NOT EXISTS 'transfer';
         END IF;
       END $$`,
    );

    // 4. Los pagos quedan imputados al turno de caja donde se cobraron.
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "cash_shift_id" uuid`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payments_cash_shift') THEN
           ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_cash_shift" FOREIGN KEY ("cash_shift_id") REFERENCES "cash_shifts"("id") ON DELETE SET NULL;
         END IF;
       END $$`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_payments_cash_shift" ON "payments" ("cash_shift_id")`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Reversión intencionalmente vacía: quitar valores de un enum y columnas
    // con datos existen no es seguro y no se solicita en reversión.
  }
}