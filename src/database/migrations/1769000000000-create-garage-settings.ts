import { MigrationInterface, QueryRunner, Table } from 'typeorm';

// Migración no destructiva: crea la tabla garage_settings si no existe.
// No toca ninguna tabla existente (users, etc.) ni ejecuta DROP/TRUNCATE/DELETE.
export class CreateGarageSettings1769000000000 implements MigrationInterface {
  name = 'CreateGarageSettings1769000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'garage_settings',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'garageName',
            type: 'varchar',
            length: '120',
            default: "'GaragePro'",
          },
          {
            name: 'terminalName',
            type: 'varchar',
            length: '60',
            default: "'Terminal 01'",
          },
          { name: 'totalSpaces', type: 'int', default: 40 },
          { name: 'currency', type: 'varchar', length: '3', default: "'PEN'" },
          {
            name: 'timezone',
            type: 'varchar',
            length: '64',
            default: "'America/Lima'",
          },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true, // ifNotExists
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Reversión intencionalmente vacía: nunca eliminamos datos ni estructuras.
  }
}
