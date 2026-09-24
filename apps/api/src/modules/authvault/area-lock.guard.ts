import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@legal-platform/contracts';
import { AreaLockService, type LockedArea } from './area-lock.service';

export const AREA_LOCK_KEY = 'area_lock';

/** Decorator: mark a handler/class as sitting inside a locked area. */
export const AreaLocked = (area: LockedArea) => SetMetadata(AREA_LOCK_KEY, area);

/**
 * P8-T2 area-lock enforcement. Runs AFTER authentication (compose with
 * JwtAccessGuard); if the area has a lock enabled, a valid
 * `X-Area-Ticket: alt_<area>_…` (12h TTL, epoch-pinned) must accompany the
 * session. No ticket / old-epoch ticket / tampered ticket → 401
 * AUTH_AREA_LOCKED; the front-end then shows the unlock dialog.
 */
@Injectable()
export class AreaLockGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly locks: AreaLockService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const area = this.reflector.getAllAndOverride<LockedArea | undefined>(AREA_LOCK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!area) return true; // no lock declared → pass through
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const ticket = req.headers['x-area-ticket'];
    const ok = await this.locks.verifyTicket(area, ticket);
    if (!ok) throw new UnauthorizedException(ERROR_CODES.AUTH_INVALID_CREDENTIALS);
    return true;
  }
}
