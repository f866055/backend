import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Delete,
  NotFoundException,
  BadRequestException,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { CloudinaryService } from './cloudinary.service';
import { User } from './entities/user.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Get()
  findAll(): Promise<User[]> {
    return this.usersService.findAll();
  }

  // El override a nivel de handler permite que cualquier usuario autenticado
  // gestione SU PROPIO perfil (el id viene del token JWT, nunca del cliente).
  @Roles(Role.USER, Role.ADMIN)
  @Get('me')
  async getMe(@CurrentUser() user: AuthUser) {
    const found = await this.usersService.findOne(user.id);
    if (!found) {
      throw new NotFoundException();
    }
    const { password: _password, ...safeUser } = found;
    return safeUser;
  }

  @Roles(Role.USER, Role.ADMIN)
  @Patch('me')
  async updateMe(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: UpdateProfileDto,
  ) {
    const updated = await this.usersService.updateProfile(authUser.id, {
      name: dto.name?.trim(),
      lastname: dto.lastname?.trim(),
      phone: dto.phone === '' ? null : dto.phone,
      image: dto.image,
    });
    if (!updated) {
      throw new NotFoundException();
    }
    const { password: _password, ...safeUser } = updated;
    return safeUser;
  }

  @Roles(Role.USER, Role.ADMIN)
  @Post('me/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
    }),
  )
  async uploadAvatar(
    @CurrentUser() authUser: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No se ha proporcionado ningún archivo de imagen',
      );
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException(
        'El archivo proporcionado no es una imagen válida',
      );
    }

    const currentUser = await this.usersService.findOne(authUser.id);
    if (!currentUser) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // Subida con Cloudinary (o fallback base64 si no estuviera configurado)
    const { url, publicId } = await this.cloudinaryService.uploadAvatar(file);

    // Si ya tenía avatar anterior en Cloudinary, limpiarlo
    if (currentUser.publicId && currentUser.publicId !== publicId) {
      await this.cloudinaryService.deleteAvatar(currentUser.publicId);
    }

    const updated = await this.usersService.updateAvatar(
      authUser.id,
      url,
      publicId,
    );
    if (!updated) {
      throw new NotFoundException('Error al actualizar el avatar del usuario');
    }

    const { password: _password, ...safeUser } = updated;
    return {
      message: 'Avatar actualizado exitosamente',
      image: url,
      user: safeUser,
    };
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<User | null> {
    return this.usersService.findOne(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.usersService.remove(id);
  }
}
