import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashShift } from './entities/cash-shift.entity';
import { CashShiftsController } from './cash-shifts.controller';
import { CashShiftsService } from './cash-shifts.service';
import { User } from '../users/entities/user.entity';
import { GarageSetting } from '../settings/entities/garage-setting.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CashShift, User, GarageSetting])],
  controllers: [CashShiftsController],
  providers: [CashShiftsService],
  exports: [CashShiftsService],
})
export class CashShiftsModule {}
