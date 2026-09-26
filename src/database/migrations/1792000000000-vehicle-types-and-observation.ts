import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Amplía el catálogo de `vehicles.type` con los tipos operativos nuevos y
 * agrega la columna `vehicles.observation` (observación opcional del operador).
 *
 * - El enum de tipo existe porque la tabla fue creada por synchronize en
 *   desarrollo; su nombre por defecto en Postgres es `vehicles_type_enum`.
 *   Se conservan los valores históricos (Sedán, SUV, Motocicleta) y se agregan
 *   los nuevos con ADD VALUE idempotente (guardado por pg_enum).
 * - `observation` se agrega con ADD COLUMN IF NOT EXISTS, idempotente ante
 *   synchronize:true en desarrollo.
 *
 * No destructiva: nunca elimina valores ni datos.
 */
export class VehicleTypesAndObservation1792000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Agregar observación (antes de tocar el enum).
    await queryRunner.query(
      `ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "observation" varchar(500)`,
    );

    // 2. Expandir el enum de tipo de vehículo (idempotente por etiqueta).
    const newTypes = [
      'Hatchback',
      'Pickup',
      'Coupé',
      'Station Wagon',
      'Minivan',
      'Furgón',
      'Camioneta',
      'Mototaxi',
      'Moto',
      'Camión',
      'Bus',
      'Taxi',
      'Otro',
    ];

    for (const label of newTypes) {
      // ADD VALUE no acepta IF NOT EXISTS en todas las versiones: se protege
      // comprobando primero pg_enum (mismo patrón que el resto de migraciones).
      await queryRunner.query(
        `DO $$ BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM pg_enum
             WHERE enumlabel = '${label}'
               AND enumtypid = 'vehicles_type_enum'::regtype
           ) THEN
             ALTER TYPE "vehicles_type_enum" ADD VALUE '${label}';
           END IF;
         END $$;`,
      );
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Reversión intencionalmente vacía: nunca eliminamos datos ni estructuras.
  }
}
