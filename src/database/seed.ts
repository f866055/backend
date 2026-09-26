import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { Role } from '../auth/enums/role.enum';

dotenv.config();

const SEED_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@garaje.com';
const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Garaje2026!';

async function seed(): Promise<void> {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'db_garaje',
    entities: [User],
  });

  await dataSource.initialize();

  try {
    const usersRepository = dataSource.getRepository(User);
    const existing = await usersRepository.findOneBy({ email: SEED_EMAIL });

    if (existing) {
      existing.role = Role.ADMIN;
      existing.password = await bcrypt.hash(SEED_PASSWORD, 10);
      await usersRepository.save(existing);
      console.log(
        `Usuario admin actualizado con rol ADMIN y contraseña: ${SEED_EMAIL}`,
      );
      return;
    }

    const admin = usersRepository.create({
      name: 'Admin',
      lastname: 'Garaje',
      email: SEED_EMAIL,
      password: await bcrypt.hash(SEED_PASSWORD, 10),
      role: Role.ADMIN,
    });

    await usersRepository.save(admin);
    console.log(`Usuario admin creado: ${SEED_EMAIL}`);
  } finally {
    await dataSource.destroy();
  }
}

seed().catch((err) => {
  console.error('Error ejecutando el seed:', err);
  process.exit(1);
});
