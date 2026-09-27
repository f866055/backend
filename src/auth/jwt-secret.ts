import { randomBytes } from 'crypto';
import type { ConfigService } from '@nestjs/config';

const MIN_SECRET_LENGTH = 16;

let devFallbackSecret: string | undefined;

/**
 * Obtiene el secreto de firma JWT.
 * En producción se recomienda definir JWT_SECRET en las variables de entorno.
 * Si no está definido, se genera un secreto aleatorio seguro y estable durante
 * el ciclo de vida del proceso para evitar que el contenedor falle al arrancar.
 */
export function resolveJwtSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_SECRET')?.trim();

  if (!secret) {
    if (!devFallbackSecret) {
      devFallbackSecret = randomBytes(32).toString('hex');
      console.warn(
        '[auth] AVISO: JWT_SECRET no definido en variables de entorno. Se ha generado una clave aleatoria segura para esta instancia.',
      );
    }
    return devFallbackSecret;
  }

  return secret;
}
