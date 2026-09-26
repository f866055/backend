import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega a `vehicles`:
 * - plate_normalized: clave canónica (mayúsculas, sin espacios/guiones/puntos)
 *   con índice UNIQUE para búsquedas y prevención de duplicados insensibles a
 *   separadores. Backfill desde `plate` existente.
 * - plate_raw: texto original tal como fue tipeado o leído por OCR.
 *
 * La migración es IDEMPOTENTE (ADD/CREATE ... IF NOT EXISTS) porque en
 * desarrollo TypeORM corre con synchronize:true y puede haber creado las
 * columnas antes de que la migración se ejecute.
 *
 * Backfill con deduplicación determinista: si dos filas colisionan al limpiar
 * (p.ej. "ABC-123" y "ABC123" creadas bajo la unicidad antigua), la más antigua
 * conserva el valor limpio y las siguientes reciben un sufijo corto del id,
 * sin perder ningún vehículo ni sus ingresos.
 */
export class AddVehiclePlateNormalized1787500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "plate_normalized" varchar(15)`,
    );
    await queryRunner.query(
      `ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "plate_raw" varchar(15)`,
    );

    // Backfill: normaliza la placa y conserva el texto original en plate_raw.
    // En caso de colisión (improbable) gana la fila más antigua; el resto recibe
    // sufijo "-XXXX" (4 primeros caracteres del uuid).
    await queryRunner.query(`
      WITH cleaned AS (
        SELECT
          id,
          UPPER(REGEXP_REPLACE("plate", '[\\s._-]', '', 'g')) AS norm,
          ROW_NUMBER() OVER (
            PARTITION BY UPPER(REGEXP_REPLACE("plate", '[\\s._-]', '', 'g'))
            ORDER BY "created_at" ASC
          ) AS rn
        FROM "vehicles"
      )
      UPDATE "vehicles" v
      SET "plate_normalized" = CASE
            WHEN c.rn = 1 THEN c.norm
            ELSE c.norm || '-' || LEFT(v."id"::text, 4)
          END,
          "plate_raw" = COALESCE(v."plate_raw", v."plate")
      FROM cleaned c
      WHERE v."id" = c."id"
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "ux_vehicles_plate_normalized" ON "vehicles" ("plate_normalized")`,
    );
    await queryRunner.query(
      `ALTER TABLE "vehicles" ALTER COLUMN "plate_normalized" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ux_vehicles_plate_normalized"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vehicles" DROP COLUMN IF EXISTS "plate_raw"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vehicles" DROP COLUMN IF EXISTS "plate_normalized"`,
    );
  }
}
