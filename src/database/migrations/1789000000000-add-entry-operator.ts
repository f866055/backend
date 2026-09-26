import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega a `parking_entries` la columna `created_by_id` (operador autenticado
 * que registró el ingreso). Se persiste para que la reimpresión del ticket
 * muestre a quién realizó la operación, no al usuario que consulta después.
 *
 * No destructiva: ADD COLUMN IF NOT EXISTS / FK IF NOT EXISTS. En desarrollo
 * TypeORM corre con synchronize:true y podría crear la columna antes de que
 * corra esta migración, por eso todo es idempotente.
 */
export class AddEntryOperator1789000000000 implements MigrationInterface {
  name = 'AddEntryOperator1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "parking_entries" ADD COLUMN IF NOT EXISTS "created_by_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "parking_entries" ADD CONSTRAINT IF NOT EXISTS "fk_parking_entries_created_by" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Reversión intencionalmente vacía: nunca eliminamos datos ni estructuras.
  }
}
