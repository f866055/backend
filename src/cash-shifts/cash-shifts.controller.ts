import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CashShiftsService } from './cash-shifts.service';
import { OpenCashShiftDto } from './dto/open-cash-shift.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('cash-shifts')
export class CashShiftsController {
  constructor(private readonly cashShiftsService: CashShiftsService) {}

  // Turno vigente (caja abierta actual o último cierre) + recaudación.
  @Roles(Role.USER, Role.ADMIN)
  @Get('current')
  current() {
    return this.cashShiftsService.current();
  }

  // Lista de todos los turnos (desglose de cajas abiertas y cerradas).
  @Roles(Role.USER, Role.ADMIN)
  @Get()
  findAll(@Query('limit') limit?: string) {
    const parsedLimit = limit ? Math.min(100, Math.max(1, parseInt(limit, 10) || 50)) : 50;
    return this.cashShiftsService.findAll(parsedLimit);
  }

  // Resumen de un turno concreto (usado tras abrir/cerrar para el panel).
  @Roles(Role.USER, Role.ADMIN)
  @Get(':id')
  byId(@Param('id') id: string) {
    return this.cashShiftsService.getShiftById(id);
  }

  // Abre una caja nueva (fondo inicial + cajero del token).
  @Roles(Role.USER, Role.ADMIN)
  @Post('open')
  open(@Body() dto: OpenCashShiftDto, @CurrentUser() user?: AuthUser) {
    return this.cashShiftsService.openShift(dto, user?.id ?? '');
  }

  // Cierra la caja abierta actual (requiere el id del turno vigente).
  @Roles(Role.USER, Role.ADMIN)
  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.cashShiftsService.closeShift(id);
  }
}