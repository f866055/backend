import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateGarageSettingsDto } from './dto/update-garage-settings.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // Lectura permitida a cualquier usuario autenticado: el nombre de terminal
  // guardado se muestra en la interfaz. La modificación queda solo para ADMIN.
  @Roles(Role.USER, Role.ADMIN)
  @Get('garage')
  getGarageSettings() {
    return this.settingsService.getGarageSettings();
  }

  @Patch('garage')
  updateGarageSettings(@Body() dto: UpdateGarageSettingsDto) {
    return this.settingsService.updateGarageSettings(dto);
  }
}
