import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import * as os from 'os';
import { AppModule } from './app.module';

function getNetworkIps(): { name: string; ip: string }[] {
  const interfaces = os.networkInterfaces();
  const results: { name: string; ip: string }[] = [];

  for (const [name, netList] of Object.entries(interfaces)) {
    for (const net of netList || []) {
      if ((net.family === 'IPv4' || (net as any).family === 4) && !net.internal) {
        results.push({ name, ip: net.address });
      }
    }
  }

  // Priorizar interfaces físicas (Wi-Fi, Ethernet) antes de interfaces virtuales (WSL, Hyper-V)
  results.sort((a, b) => {
    const isVirtualA = /vethernet|virtual|docker|wsl|hyper-v/i.test(a.name);
    const isVirtualB = /vethernet|virtual|docker|wsl|hyper-v/i.test(b.name);
    if (isVirtualA && !isVirtualB) return 1;
    if (!isVirtualA && isVirtualB) return -1;
    return 0;
  });

  return results;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  // Allowlist de orígenes: localhost, 127.0.0.1 y cualquier IP local en la red Wi-Fi
  const configuredCors = (
    configService.get<string>('CORS_ORIGINS') || 'http://localhost:3001'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      // Permitir peticiones sin origen (apps nativas, healthchecks, mobile web)
      if (!origin) return callback(null, true);

      const isAllowed =
        configuredCors.includes(origin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(
          origin,
        );

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error(`Origen no permitido por CORS: ${origin}`));
      }
    },
    credentials: true,
  });

  app.use(cookieParser());

  app.setGlobalPrefix('api', {
    exclude: ['health', ''],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = configService.get<number>('PORT', 3000);

  await app.listen(port, '0.0.0.0');

  const networkIps = getNetworkIps();
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const isProd = nodeEnv === 'production';

  console.log(`\n🚀 Backend NestJS iniciado [Entorno: ${nodeEnv.toUpperCase()}]:`);
  console.log(`   - Modo:     ${isProd ? 'Producción (TypeORM Sync: OFF, Cookies Seguras: ON)' : 'Desarrollo (TypeORM Sync: ON, Cookies Seguras: OFF)'}`);
  console.log(`   - Local:    http://localhost:${port}`);
  if (networkIps.length > 0) {
    networkIps.forEach(({ name, ip }) => {
      console.log(`   - Network:  http://${ip}:${port} (${name})`);
    });
  }
  console.log(`   - API:      http://localhost:${port}/api\n`);
}

bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error ?? 'Error desconocido');

  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    const host = process.env.DB_HOST ?? 'localhost';
    const dbPort = process.env.DB_PORT ?? '5432';
    console.error(
      `\n❌ [DB] No se pudo conectar a PostgreSQL en ${host}:${dbPort} (timeout de 5s agotado).`,
    );
    console.error(
      '   → Verifica que el servicio "postgresql-x64-18" esté iniciado y vuelve a ejecutar el backend.\n',
    );
  } else {
    console.error('\n❌ Error fatal al iniciar el servidor:', message, '\n');
  }

  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
