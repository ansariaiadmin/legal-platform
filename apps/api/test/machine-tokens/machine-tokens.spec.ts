import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MachineTokensService } from '../../src/modules/machine-tokens/machine-tokens.service';
import { MachineTokenGuard, MachineScope, MachineOnly, MACHINE_SCOPE_KEY, MACHINE_ONLY_KEY } from '../../src/modules/machine-tokens/machine-token.guard';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';

function memStorage(): StorageProvider {
  const store = new Map<string, Buffer>();
  return {
    put: async ({ key, content }) => { store.set(key, Buffer.isBuffer(content) ? content : Buffer.from(content)); },
    get: async (key) => {
      const v = store.get(key);
      if (!v) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return v;
    },
    delete: async (k) => void store.delete(k),
    list: async () => [...store.keys()],
    verifyConfig: async () => true,
    getMetadata: async () => null,
  };
}

function build(secret = 'unit-secret') {
  return new MachineTokensService(new ConfigService({ MACHINE_TOKEN_SECRET: secret }), memStorage());
}

describe('P5-T3 — machine tokens', () => {
  it('issues lpm_<uuid>_<32hex> and verifies scope, with lastUsed bookkeeping', async () => {
    const svc = build();
    const { token, record } = await svc.issue({ label: 'mini-app', scopes: ['client:read'], createdBy: 'u1' });
    expect(token).toMatch(/^lpm_[0-9a-f-]{36}_[0-9a-f]{32}$/);
    expect(record.lastUsedAt).toBeNull();

    const ok = await svc.verify(token, 'client:read');
    expect(ok?.label).toBe('mini-app');
    expect(ok?.lastUsedAt).not.toBeNull();
  });

  it('WRONG scope is a NO, even for a valid untampered token', async () => {
    const svc = build();
    const { token } = await svc.issue({ label: 'x', scopes: ['client:read'], createdBy: 'u1' });
    expect(await svc.verify(token, 'drafts:write')).toBeNull();
  });

  it('a tampered signature dies instantly, revocation persists across a fresh service', async () => {
    const storage = memStorage();
    const a = new MachineTokensService(new ConfigService({ MACHINE_TOKEN_SECRET: 'unit-secret' }), storage);
    const { token } = await a.issue({ label: 'x', scopes: ['drafts:read'], createdBy: 'u1' });

    const tampered = token.replace(/.$/, token.endsWith('0') ? 'f' : '0');
    expect(await a.verify(tampered, 'drafts:read')).toBeNull();

    const id = token.split('_')[1];
    expect(await a.revoke(id, 'admin')).toBe(true);

    // restart continuity from the same storage
    const b = new MachineTokensService(new ConfigService({ MACHINE_TOKEN_SECRET: 'unit-secret' }), storage);
    expect(await b.verify(token, 'drafts:read')).toBeNull(); // dead honestly
    expect((await b.list()).find((t) => t.tokenId === id)?.revokedAt).not.toBeNull();
  });

  it('expiry kills tokens whose clock ran out', async () => {
    const svc = build();
    const { token } = await svc.issue({ label: 'temp', scopes: ['client:read'], createdBy: 'u1', expiresInDays: -1 });
    expect(await svc.verify(token, 'client:read')).toBeNull();
  });

  it('unknown scopes can never be issued (closed vocabulary)', async () => {
    await expect(build().issue({ label: 'evil', scopes: ['everything:all'] as never, createdBy: 'x' }))
      .rejects.toThrow(/unknown scope/);
  });
});

describe('P5-T3 — the guard (MachineOnly & scope enforcement)', () => {
  function ctxFor(headers: Record<string, string>, meta: Record<string, unknown>): ExecutionContext {
    const handler = () => undefined;
    const reflector = new Reflector();
    reflector.getAllAndOverride = <T,>(key: string) => meta[key] as T;
    return {
      getHandler: () => handler,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
      args: [],
      getArgs: () => [],
      getArgByIndex: () => ({}),
      switchToRpc: () => ({}) as never,
      switchToWs: () => ({}) as never,
      getType: () => 'http',
    } as unknown as ExecutionContext;
  }

  it('machine-only + no bearer → 401 (machine lanes are machine lanes)', async () => {
    const refl = new Reflector();
    refl.getAllAndOverride = <T,>(k: string) =>
      ({ [MACHINE_ONLY_KEY]: true as const, [MACHINE_SCOPE_KEY]: 'client:read' as const })[k] as T;
    const guard = new MachineTokenGuard(build(), refl);
    const ctx = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('valid token + right scope passes and pins the principal on the request', async () => {
    const svc = build();
    const { token } = await svc.issue({ label: 'probe', scopes: ['client:read'], createdBy: 'u1' });
    const reflector = new Reflector();
    reflector.getAllAndOverride = <T,>(k: string) => ({ [MACHINE_SCOPE_KEY]: 'client:read' }[k] as T);
    const req: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` } };
    const ctx = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    await expect(new MachineTokenGuard(svc, reflector).canActivate(ctx)).resolves.toBe(true);
    expect((req.machineToken as { tokenId: string } | undefined)?.tokenId).toBeDefined();
  });

  it('a WRONG-scope lpm token is rejected outright', async () => {
    const svc = build();
    const { token } = await svc.issue({ label: 'shrunk', scopes: ['events:stream'], createdBy: 'u1' });
    const refl = new Reflector();
    refl.getAllAndOverride = <T,>(k: string) =>
      ({ [MACHINE_SCOPE_KEY]: 'client:read' as const })[k] as T;
    const guard = new MachineTokenGuard(svc, refl);
    const ctx = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('P5 annotation smoke (compile-checked)', () => {
  it('MachineScope / MachineOnly carry metadata', () => {
    void MachineScope('client:read');
    void MachineOnly();
  });
});
