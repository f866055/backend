import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { Role } from '../../auth/enums/role.enum';

@Entity('usuarios')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'nombre', length: 100 })
  name: string;

  @Column({ name: 'apellido', length: 100 })
  lastname: string;

  @Column({ name: 'telefono', type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ name: 'correo', unique: true })
  email: string;

  @Column({ name: 'contrasena' })
  password: string;

  @Column({
    name: 'rol',
    type: 'enum',
    enum: Role,
    enumName: 'usuarios_rol_enum',
    nullable: true,
  })
  role: Role | null;

  @Column({ name: 'imagen', nullable: true })
  image: string;

  @Column({ name: 'public_id', nullable: true })
  publicId: string;

  @CreateDateColumn({ name: 'creado_en' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'actualizado_en' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'eliminado_en' })
  deletedAt: Date;
}
