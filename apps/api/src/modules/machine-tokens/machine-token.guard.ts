import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@legal-platform/contracts';
import { MachineTokensService, type MachineTokenScope, type MachineToken } from './machine-tokens.service';

/**
 * Machine-token gate (P5-T3). Any route can declare
 *   @MachineScope('client:read')
 * and this guard checks the `Authorization: Bearer lpm_...` token's math,
 * revocability, expiry AND scope before letting the handler run. Endpoints
 * stay human-JWT too: the guard ONLY rejects when an lpm_ token WAS
 * presented but failed (a client JWT passes through untouched so
 * `UseGuards(MachineTokenGuard, JwtAccessGuard)` composes).
 */
export const MACHINE_SCOPE_KEY = 'machine-token-scope';
export const MACHINE_ONLY_KEY = 'machine-token-only';
export const MachineScope = (scope: MachineTokenScope) => SetMetadata(MACHINE_SCOPE_KEY, scope);
/** When present, a plain human JWT does NOT pass — the route is for machines. */
export const MachineOnly = () => SetMetadata(MACHINE_ONLY_KEY, true);

export interface MachinePrincipal {
  tokenId: string;
  label: string;
  scopes: MachineTokenScope[];
}

const requestTokenKey = 'machineToken';

@Injectable()
export class MachineTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: MachineTokensService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.getAllAndOverride<MachineTokenScope>(MACHINE_SCOPE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const machineOnly = this.reflector.getAllAndOverride<boolean>(MACHINE_ONLY_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      [requestTokenKey]?: MachineToken;
    }>();
    const auth = req.headers['authorization'] ?? '';
    if (!auth.startsWith('Bearer lpm_')) {
      if (machineOnly) throw new UnauthorizedException(ERROR_CODES.MACHINE_TOKEN_REQUIRED);
      // human traffic — the JwtAccessGuard (also on the route) does its job
      return true;
    }
    const raw = auth.slice('Bearer '.length);
    if (!scope) throw new UnauthorizedException(ERROR_CODES.MACHINE_TOKEN_REQUIRED);
    const verified = await this.tokens.verify(raw, scope);
    if (!verified) throw new UnauthorizedException(ERROR_CODES.MACHINE_TOKEN_INVALID);
    req[requestTokenKey] = verified;
    return true;
  }
}

export const MachineTokenInfo = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): MachineToken | undefined =>
    ctx.switchToHttp().getRequest()[requestTokenKey],
);
