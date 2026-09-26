import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreateCreditDto } from './dto/create-credit.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { PaymentLookupExceptionFilter } from './exceptions/payment-lookup-exception.filter';

@UseGuards(JwtAuthGuard, RolesGuard)
@UseFilters(PaymentLookupExceptionFilter)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // Búsqueda de la salida: ingreso ACTIVO por ticket (#TK-8829) o placa.
  @Roles(Role.USER, Role.ADMIN)
  @Get('active-entry')
  lookupActiveEntry(@Query('q') q?: string) {
    return this.paymentsService.lookupActiveEntry(q ?? '');
  }

  // Resumen del turno (día actual) de Caja: efectivo / tarjeta / abonos.
  @Roles(Role.USER, Role.ADMIN)
  @Get('summary')
  getShiftSummary() {
    return this.paymentsService.getShiftSummary();
  }

  // Registra un ABONO (pago a cuenta) sobre un ticket ACTIVO.
  @Roles(Role.USER, Role.ADMIN)
  @Post('credit')
  createCredit(@Body() dto: CreateCreditDto) {
    return this.paymentsService.registerCredit(dto);
  }

  // Registra el pago FINAL y cierra el ticket (atómico).
  @Roles(Role.USER, Role.ADMIN)
  @Post()
  createPayment(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.processPayment(dto);
  }
}
