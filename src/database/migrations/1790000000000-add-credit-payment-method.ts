import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega el valor 'credit' al enum payments_method_enum para soportar ABONOS
 * (pagos a cuenta de un ticket ACTIVO que no lo cierran).
 *
 * PostgreSQL no permite ALTER TYPE dentro de transacción (comando DDL), por lo
 * que debe ejecutarse en su propio paso. Idempotente: revisa que el valor aún
 * no exista antes de agregarlo.
 */
export class AddCreditPaymentMethod1790000000000 implements MigrationInterface {
  name = 'AddCreditPaymentMethod1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_enum
           JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
           WHERE pg_type.typname = 'payments_method_enum'
             AND pg_enum.enumlabel = 'credit'
         ) THEN
           ALTER TYPE "payments_method_enum" ADD VALUE IF NOT EXISTS 'credit';
         END IF;
       END $$`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Reversión intencionalmente vacía: quitar valores de un enum de forma
    // segura requiere reconstruir el tipo, lo que no hacemos en reversión.
  }
}
