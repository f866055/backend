import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';

const SALT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

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
