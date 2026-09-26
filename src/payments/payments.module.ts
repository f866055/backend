import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { Payment } from './entities/payment.entity';
import { ParkingEntry } from '../vehicles/entities/parking-entry.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { GarageSetting } from '../settings/entities/garage-setting.entity';
import { CashShiftsModule } from '../cash-shifts/cash-shifts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Payment,
      ParkingEntry,
      Vehicle,
      GarageSetting,
    ]),
    CashShiftsModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}