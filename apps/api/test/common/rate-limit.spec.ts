import { RateLimitService } from '../../src/common/rate-limit.service';

describe('RateLimitService', () => {
  let limiter: RateLimitService;

  beforeEach(() => {
    limiter = new RateLimitService();
  });

  afterEach(() => {
    limiter.onModuleDestroy();
  });

  it('admits hits up to the limit and counts each hit exactly once', () => {
    const rule = { limit: 3, windowMs: 60_000 };

    expect(limiter.consume('k', rule)).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.consume('k', rule)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume('k', rule)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.consume('k', rule)).toMatchObject({ allowed: false, rejection: 'limit' });
  });

  /**
   * Regression: the previous inline limiter set count to 1 on the first call
   * and then incremented again after the work, so a limit of 5 tripped on the
   * third request.
   */
  it('does not double-count a single request', () => {
    const rule = { limit: 5, windowMs: 60_000 };

    for (let i = 0; i < 5; i += 1) {
      expect(limiter.consume('double', rule).allowed).toBe(true);
    }
    expect(limiter.consume('double', rule).allowed).toBe(false);
  });

  /**
   * Regression: the cooldown used to be evaluated after the counter was
   * incremented, so a rejected request still consumed quota.
   */
  it('does not consume quota when the cooldown rejects the request', () => {
    const rule = { limit: 5, windowMs: 60_000, cooldownMs: 60_000 };

    expect(limiter.consume('cool', rule)).toMatchObject({ allowed: true, remaining: 4 });
    expect(limiter.consume('cool', rule)).toMatchObject({ allowed: false, rejection: 'cooldown', remaining: 4 });
    expect(limiter.consume('cool', rule)).toMatchObject({ allowed: false, rejection: 'cooldown', remaining: 4 });
  });

  it('keeps keys isolated from each other', () => {
    const rule = { limit: 1, windowMs: 60_000 };

    expect(limiter.consume('a', rule).allowed).toBe(true);
    expect(limiter.consume('b', rule).allowed).toBe(true);
    expect(limiter.consume('a', rule).allowed).toBe(false);
  });

  it('clears a key on reset', () => {
    const rule = { limit: 1, windowMs: 60_000 };

    expect(limiter.consume('reset-me', rule).allowed).toBe(true);
    limiter.reset('reset-me');
    expect(limiter.consume('reset-me', rule).allowed).toBe(true);
  });

  it('opens a new window once the previous one has elapsed', () => {
    const rule = { limit: 1, windowMs: 1 };

    expect(limiter.consume('window', rule).allowed).toBe(true);

    const waitUntilNextWindow = Date.now() + 5;
    while (Date.now() < waitUntilNextWindow) {
      // busy-wait: the window is 1ms, timers would be flakier
    }

    expect(limiter.consume('window', rule).allowed).toBe(true);
  });
});
