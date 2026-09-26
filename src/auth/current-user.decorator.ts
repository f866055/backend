import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from './enums/role.enum';

export interface AuthUser {
  id: string;
  email: string;
  role: Role | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return request.user;
  },
);
