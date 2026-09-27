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
    for (const net of netList ?? []) {
      // Node >= 18 devuelve `family` como string; versiones previas, como número.
      if (String(net.family) === 'IPv4' && !net.internal) {
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

  // Allowlist de orígenes: localhost, 127.0.0.1, FRONTEND_URL y producción Railway
  const configuredCors = Array.from(
    new Set([
      'https://frontend-production-1824.up.railway.app',
      'http://localhost:3001',
      ...(
        configService.get<string>('CORS_ORIGIN') ||
        configService.get<string>('CORS_ORIGINS') ||
        ''
      )
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ]),
  );

  const rawFrontendUrl =
    configService.get<string>('FRONTEND_URL') ||
    configService.get<string>('FRONTEND');
  if (rawFrontendUrl) {
    rawFrontendUrl
      .split(',')
      .map((url) => {
        try {
          const parsed = new URL(url.trim());
          return parsed.origin;
        } catch {
          return url.trim().replace(/\/+$/, '');
        }
      })
      .filter(Boolean)
      .forEach((origin) => {
        if (!configuredCors.includes(origin)) {
          configuredCors.push(origin);
        }
      });
  }

  // Los comodines de dominio solo se activan de forma explícita: aceptar
  // cualquier "*.railway.app" o "*.vercel.app" permite que otro proyecto
  // llame a esta API con las credenciales de un usuario.
  const allowRailwaySubdomains =
    configService.get<string>('CORS_ALLOW_RAILWAY_SUBDOMAINS') === 'true';
  const allowVercelSubdomains =
    configService.get<string>('CORS_ALLOW_VERCEL_SUBDOMAINS') === 'true';
  const privateNetworkPattern =
    /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/;

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Permitir peticiones sin origen (apps nativas, healthchecks, mobile web, Postman)
      if (!origin) return callback(null, true);

      const isAllowed =
        configuredCors.includes(origin) ||
        (allowRailwaySubdomains && /\.railway\.app$/.test(origin)) ||
        (allowVercelSubdomains && /\.vercel\.app$/.test(origin)) ||
        privateNetworkPattern.test(origin);

      // Un origen no permitido se rechaza sin header CORS (respuesta 500 sería
      // engañosa para el cliente y oculta la causa real).
      callback(null, isAllowed);
    },
    credentials: true,
  });

  app.use(cookieParser());

  app.setGlobalPrefix('api', {
    exclude: ['health', '', 'api'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT || configService.get('PORT') || 3000);

  await app.listen(port, '0.0.0.0');

  const networkIps = getNetworkIps();
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const isProd = nodeEnv === 'production';

  console.log(
    `\n🚀 Backend NestJS iniciado [Entorno: ${nodeEnv.toUpperCase()}]:`,
  );
  console.log(
    `   - Modo:     ${isProd ? 'Producción (TypeORM Sync: OFF, Cookies Seguras: ON)' : 'Desarrollo (TypeORM Sync: ON, Cookies Seguras: OFF)'}`,
  );
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
      : typeof error === 'string'
        ? error
        : 'Error desconocido';

  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    const host = process.env.PGHOST ?? process.env.DB_HOST ?? 'localhost';
    const dbPort = process.env.PGPORT ?? process.env.DB_PORT ?? '5432';
    console.error(
      `\n❌ [DB] No se pudo conectar a PostgreSQL en ${host}:${dbPort}.`,
    );
    console.error(
      '   → Revisa DATABASE_URL y que el servicio de base de datos esté en el mismo proyecto de Railway.\n',
    );
  } else {
    console.error('\n❌ Error fatal al iniciar el servidor:', message, '\n');
  }

  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
