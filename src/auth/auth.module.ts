import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginThrottleGuard } from './login-throttle.guard';
import { UsersModule } from '../users/users.module';
import { resolveJwtSecret } from './jwt-secret';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const rawExpires = configService.get<string>('JWT_EXPIRES_IN', '1d');
        const isValidTimespan =
          typeof rawExpires === 'string' &&
          (/^\d+[smhdwy]$/.test(rawExpires.trim()) ||
            !isNaN(Number(rawExpires.trim())));
        const expiresIn = (
          isValidTimespan ? rawExpires.trim() : '1d'
        ) as StringValue;

        return {
          secret: resolveJwtSecret(configService),
          signOptions: {
            expiresIn,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, LoginThrottleGuard],
  exports: [JwtModule, AuthService, JwtAuthGuard, LoginThrottleGuard],
})
export class AuthModule {}
