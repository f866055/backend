import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  // Vehículos dentro del garaje ahora mismo (ocupación actual).
  @Roles(Role.USER, Role.ADMIN)
  @Get('entries/active')
  getActiveEntries() {
    return this.vehiclesService.getActiveEntries();
  }

  /*
    Búsqueda del flujo de ingreso: la lupa / Enter consultan por placa.
    Acepta mayúsculas/minúsculas, guiones y espacios (el servicio normaliza).
    Devuelve además el ingreso activo si existe, para la advertencia de
    duplicados. 404 habilita el formulario de registro en el frontend.
  */
  @Roles(Role.USER, Role.ADMIN)
  @Get(':plate')
  async findByPlate(@Param('plate') plate: string) {
    return this.vehiclesService.findByPlate(plate);
  }

  // Flujo "Registrar Vehículo e Ingresar": crea vehículo + ticket de ingreso.
  // ?force=true SOLO surte efecto para rol ADMIN (garaje lleno).
  @Roles(Role.USER, Role.ADMIN)
  @Post()
  createWithEntry(
    @Body() dto: CreateVehicleDto,
    @Query('force') force: string | undefined,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.vehiclesService.createVehicleWithEntry(dto, {
      force: force === 'true',
      role: user?.role ?? null,
      operator: user ?? null,
    });
  }

  // Ingreso directo de un vehículo ya registrado ("Registrar Ingreso").
  // ?force=true SOLO surte efecto para rol ADMIN (garaje lleno).
  @Roles(Role.USER, Role.ADMIN)
  @Post(':plate/entry')
  registerEntry(
    @Param('plate') plate: string,
    @Query('force') force: string | undefined,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.vehiclesService.registerEntry(plate, {
      force: force === 'true',
      role: user?.role ?? null,
      operator: user ?? null,
    });
  }
}
