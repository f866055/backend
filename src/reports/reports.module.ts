import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ParkingEntry } from '../vehicles/entities/parking-entry.entity';
import { Payment } from '../payments/entities/payment.entity';
import { GarageSetting } from '../settings/entities/garage-setting.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ParkingEntry, Payment, GarageSetting])],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
