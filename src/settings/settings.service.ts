import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GarageSetting } from './entities/garage-setting.entity';
import { UpdateGarageSettingsDto } from './dto/update-garage-settings.dto';

const DEFAULT_SETTINGS = {
  garageName: 'GaragePro',
  terminalName: 'Terminal 01',
  totalSpaces: 40,
  ratePerHour: 2.0,
  currency: 'PEN',
  timezone: 'America/Lima',
};

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(GarageSetting)
    private readonly settingsRepository: Repository<GarageSetting>,
  ) {}

  // Devuelve la fila única; si aún no se ha guardado ninguna configuración,
  // responde con los valores por defecto sin inventar datos adicionales.
  async getGarageSettings(): Promise<
    Omit<GarageSetting, 'id' | 'createdAt' | 'updatedAt'>
  > {
    const rows = await this.settingsRepository.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });
    const row = rows[0];
    if (!row) {
      return { ...DEFAULT_SETTINGS };
    }
    return {
      garageName: row.garageName,
      terminalName: row.terminalName,
      totalSpaces: row.totalSpaces,
      ratePerHour: Number(row.ratePerHour),
      currency: row.currency,
      timezone: row.timezone,
    };
  }

  async updateGarageSettings(
    dto: UpdateGarageSettingsDto,
  ): Promise<Omit<GarageSetting, 'id' | 'createdAt' | 'updatedAt'>> {
    const rows = await this.settingsRepository.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });
    let row = rows[0];
    if (!row) {
      row = this.settingsRepository.create({ ...DEFAULT_SETTINGS, ...dto });
    } else {
      Object.assign(row, dto);
    }

    try {
      const saved = await this.settingsRepository.save(row);
      return {
        garageName: saved.garageName,
        terminalName: saved.terminalName,
        totalSpaces: saved.totalSpaces,
        ratePerHour: Number(saved.ratePerHour),
        currency: saved.currency,
        timezone: saved.timezone,
      };
    } catch {
      throw new NotFoundException('No se pudo guardar la configuración');
    }
  }
}
