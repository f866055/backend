import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService, ReportsResponse } from './reports.service';
import { GetReportsQueryDto } from './dto/get-reports-query.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /*
    Reporte de transacciones: indicadores + tabla. Los filtros (rango de
    fechas, tipo de vehículo, placa, estado de pago y búsqueda por placa /
    código de ticket) se aplican en el backend sobre los datos reales.
  */
  @Roles(Role.USER, Role.ADMIN)
  @Get()
  getReports(@Query() query: GetReportsQueryDto): Promise<ReportsResponse> {
    return this.reportsService.getReports(query);
  }
}
