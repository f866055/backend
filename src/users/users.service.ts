import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { User } from './entities/user.entity';
import { Role } from '../auth/enums/role.enum';
import { DatabaseBootstrapService } from '../database/database-bootstrap.service';

const SALT_ROUNDS = 10;
const DEFAULT_DEV_ADMIN_EMAIL = 'admin@garaje.com';
const DEFAULT_DEV_ADMIN_PASSWORD = 'Garaje2026!';

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly configService: ConfigService,
    private readonly databaseBootstrap: DatabaseBootstrapService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Garantiza que el esquema exista antes de insertar el usuario admin.
    await this.databaseBootstrap.ensureSchema();
    await this.ensureAdminUser();
  }

  /**
   * Crea el usuario administrador inicial SOLO si no existe.
   * Nunca sobrescribe la contraseña de una cuenta existente: en producción la
   * contraseña se define una vez con ADMIN_PASSWORD (o SEED_ADMIN_PASSWORD) y
   * un redeploy no debe restaurarla a un valor conocido.
   */
  async ensureAdminUser(): Promise<void> {
    if (this.configService.get<string>('SEED_ADMIN_ENABLED') === 'false') {
      return;
    }

    const isProd =
      this.configService.get<string>('NODE_ENV', 'development') ===
      'production';
    const email = (
      this.configService.get<string>('SEED_ADMIN_EMAIL') ??
      this.configService.get<string>('ADMIN_EMAIL') ??
      DEFAULT_DEV_ADMIN_EMAIL
    )
      .trim()
      .toLowerCase();
    const password =
      this.configService.get<string>('SEED_ADMIN_PASSWORD') ??
      this.configService.get<string>('ADMIN_PASSWORD') ??
      DEFAULT_DEV_ADMIN_PASSWORD;
    const forceSync =
      this.configService.get<string>('SEED_ADMIN_SYNC') === 'true';

    try {
      const existing = await this.findByEmail(email);

      if (existing) {
        let updated = false;
        if (existing.role !== Role.ADMIN) {
          existing.role = Role.ADMIN;
          updated = true;
        }
        const passwordMatches = await bcrypt
          .compare(password, existing.password)
          .catch(() => false);
        if (!passwordMatches && (forceSync || email === DEFAULT_DEV_ADMIN_EMAIL)) {
          existing.password = await bcrypt.hash(password, SALT_ROUNDS);
          updated = true;
          this.logger.log(`[Seed] Contraseña de ${email} sincronizada.`);
        }
        if (updated) {
          await this.usersRepository.save(existing);
        }
        return;
      }

      const admin = this.usersRepository.create({
        name: 'Admin',
        lastname: 'Garage',
        email,
        password: await bcrypt.hash(password, SALT_ROUNDS),
        role: Role.ADMIN,
      });
      await this.usersRepository.save(admin);
      this.logger.log(`[Seed] Usuario admin ${email} creado.`);
    } catch (error) {
      this.logger.error(
        '[Seed] No se pudo asegurar el usuario admin inicial:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  findOne(id: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ id });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ email });
  }

  async create(data: Partial<User>): Promise<User> {
    if (data.password) {
      data.password = await bcrypt.hash(data.password, SALT_ROUNDS);
    }
    const user = this.usersRepository.create(data);
    return this.usersRepository.save(user);
  }

  async updateProfile(
    id: string,
    data: {
      name?: string;
      lastname?: string;
      phone?: string | null;
      image?: string;
    },
  ): Promise<User | null> {
    await this.usersRepository.update(id, data);
    return this.findOne(id);
  }

  async updateAvatar(
    id: string,
    imageUrl: string,
    publicId?: string,
  ): Promise<User | null> {
    await this.usersRepository.update(id, { image: imageUrl, publicId });
    return this.findOne(id);
  }

  async updatePassword(id: string, plainPassword: string): Promise<void> {
    const hashed = await bcrypt.hash(plainPassword, SALT_ROUNDS);
    await this.usersRepository.update(id, { password: hashed });
  }

  async remove(id: string): Promise<void> {
    await this.usersRepository.softDelete(id);
  }
}
