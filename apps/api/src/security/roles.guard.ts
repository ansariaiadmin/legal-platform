import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@legal-platform/domain';
import { ERROR_CODES } from '@legal-platform/contracts';
import type { AuthenticatedUser } from './authenticated-user';

export const ROLES_KEY = 'roles';

/**
 * Restricts a handler to the given roles (SPEC section 1: lawyer_owner, staff,
 * client, operator).
 *
 * Must be `SetMetadata` - a hand-rolled `Reflect.defineMetadata` call is not
 * visible to `Reflector.getAllAndOverride`, which reads the metadata key
 * through Nest's own helper.
 */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();

    const user = request.user;
    if (!user || !Array.isArray(user.roles) || user.roles.length === 0) {
      throw new ForbiddenException(ERROR_CODES.AUTH_INSUFFICIENT_ROLE);
    }

    const hasRole = requiredRoles.some((role) => user.roles.includes(role));
    if (!hasRole) {
      throw new ForbiddenException(ERROR_CODES.AUTH_INSUFFICIENT_ROLE);
    }

    return true;
  }
}
