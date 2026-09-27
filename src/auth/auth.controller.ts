import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginThrottleGuard } from './login-throttle.guard';
import { CurrentUser } from './current-user.decorator';
import type { AuthUser } from './current-user.decorator';
import { JWT_COOKIE_NAME } from './jwt.strategy';
import { UsersService } from '../users/users.service';

const EXPIRY_MULTIPLIERS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @UseGuards(LoginThrottleGuard)
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { access_token, user } = await this.authService.login(dto);

    res.cookie(JWT_COOKIE_NAME, access_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      maxAge: this.getCookieMaxAgeMs(),
      path: '/',
    });

    return { access_token, user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response) {
    this.clearSessionCookie(res);
    return { message: 'Sesión cerrada' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.changePassword(authUser.id, dto);
    // La contraseña cambió: se invalida la sesión actual y el cliente
    // debe autenticarse nuevamente.
    this.clearSessionCookie(res);
    return { message: 'Contraseña actualizada. Inicia sesión nuevamente.' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() authUser: AuthUser) {
    const user = await this.usersService.findOne(authUser.id);
    if (!user) {
      throw new UnauthorizedException();
    }
    const { password: _password, ...safeUser } = user;
    return safeUser;
  }

  private clearSessionCookie(res: Response): void {
    res.clearCookie(JWT_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      path: '/',
    });
  }

  private getCookieMaxAgeMs(): number {
    const expires = this.configService.get<string>('JWT_EXPIRES_IN', '1d');
    const match = expires.match(/^(\d+)([smhd])$/);
    if (!match) {
      return EXPIRY_MULTIPLIERS.d;
    }
    return Number(match[1]) * EXPIRY_MULTIPLIERS[match[2]];
  }
}
