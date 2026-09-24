import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@legal-platform/domain';
import { ERROR_CODES } from '@legal-platform/contracts';
import { Roles, RolesGuard, ROLES_KEY } from '../../src/security/roles.guard';
import type { AuthenticatedUser } from '../../src/security/authenticated-user';

class DashboardController {
  @Roles(UserRole.LAWYER_OWNER, UserRole.OPERATOR)
  ownerOnly(): void {
    /* guarded */
  }

  publicRoute(): void {
    /* unguarded */
  }
}

const createContext = (user?: AuthenticatedUser): ExecutionContext =>
  ({
    getHandler: () => DashboardController.prototype.ownerOnly,
    getClass: () => DashboardController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('reads the metadata written by the Roles() decorator', () => {
    const reflector = new Reflector();
    const roles = reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      DashboardController.prototype.ownerOnly,
      DashboardController,
    ]);

    // A hand-rolled Reflect.defineMetadata would return undefined here, which is
    // why the decorator had to move to SetMetadata.
    expect(roles).toEqual([UserRole.LAWYER_OWNER, UserRole.OPERATOR]);
  });

  it('allows a user holding one of the required roles', () => {
    const user: AuthenticatedUser = { id: 'u1', sessionId: 's1', roles: [UserRole.LAWYER_OWNER] };

    expect(guard.canActivate(createContext(user))).toBe(true);
  });

  it('rejects a user with an insufficient role', () => {
    const user: AuthenticatedUser = { id: 'u2', sessionId: 's2', roles: [UserRole.CLIENT] };

    expect(() => guard.canActivate(createContext(user))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(createContext(user))).toThrow(ERROR_CODES.AUTH_INSUFFICIENT_ROLE);
  });

  it('rejects a request whose token carried no roles', () => {
    const user: AuthenticatedUser = { id: 'u3', sessionId: 's3', roles: [] };

    expect(() => guard.canActivate(createContext(user))).toThrow(ERROR_CODES.AUTH_INSUFFICIENT_ROLE);
  });

  it('lets handlers without a Roles() decorator through', () => {
    const context = {
      getHandler: () => DashboardController.prototype.publicRoute,
      getClass: () => DashboardController,
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });
});
