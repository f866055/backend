import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 10;
const MAX_TRACKED_KEYS = 10_000;

interface LoginRequest extends Request {
  body: { email?: unknown };
}

interface AttemptBucket {
  count: number;
  resetAt: number;
}

/**
 * Limita los intentos de inicio de sesión por IP + correo para frenar ataques
 * de fuerza bruta sin depender de un servicio externo. Es por instancia: al
 * reiniciar el proceso la lista vuelve a cero.
 */
@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private readonly logger = new Logger(LoginThrottleGuard.name);
  private readonly buckets = new Map<string, AttemptBucket>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<LoginRequest>();
    const email =
      typeof request.body?.email === 'string'
        ? request.body.email.trim().toLowerCase()
        : '';
    const ip = request.ip ?? request.socket.remoteAddress ?? 'desconocida';
    const key = `${ip}|${email}`;
    const now = Date.now();

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.register(key, now);
      return true;
    }

    bucket.count += 1;
    if (bucket.count > MAX_ATTEMPTS_PER_WINDOW) {
      this.logger.warn(
        `Login bloqueado temporalmente para ${email || 'correo vacío'} (${ip}).`,
      );
      throw new HttpException(
        'Demasiados intentos de inicio de sesión. Inténtalo de nuevo en un minuto.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private register(key: string, now: number): void {
    if (this.buckets.size >= MAX_TRACKED_KEYS) {
      this.sweep(now);
    }
    this.buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
