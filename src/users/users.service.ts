import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { Role } from '../auth/enums/role.enum';

const SALT_ROUNDS = 10;

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureAdminUser();
  }

  async ensureAdminUser(
    email = 'admin@garaje.com',
    password = 'Garaje2026!',
  ): Promise<void> {
    try {
      const existing = await this.findByEmail(email);
      if (existing) {
        let needsUpdate = false;
        if (existing.role !== Role.ADMIN) {
          existing.role = Role.ADMIN;
          needsUpdate = true;
        }
        const matches = await bcrypt.compare(password, existing.password);
        if (!matches) {
          existing.password = await bcrypt.hash(password, SALT_ROUNDS);
          needsUpdate = true;
        }
        if (needsUpdate) {
          await this.usersRepository.save(existing);
          console.log(
            `[Seed] Usuario admin ${email} actualizado con rol ADMIN.`,
          );
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
      console.log(`[Seed] Usuario admin ${email} creado automáticamente.`);
    } catch (error) {
      console.warn(
        '[Seed] No se pudo asegurar el usuario admin inicial:',
        (error as Error).message,
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
