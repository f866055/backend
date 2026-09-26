import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { GarageSetting } from './entities/garage-setting.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GarageSetting])],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
