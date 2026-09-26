import { ConflictException } from '@nestjs/common';
import { ClientController } from '../../src/modules/billing/client.controller';
import type { WalletService } from '../../src/modules/billing/wallet.service';
import type { BillingService } from '../../src/modules/billing/billing.service';
import type { ConsultationQueueService } from '../../src/modules/consultation/queue.service';
import type { NotificationService } from '../../src/modules/notifications/notification.service';

const user = { id: 'u1', roles: ['client'] } as never;

function build(overrides: { notifications?: Partial<NotificationService>; wallet?: Partial<WalletService> } = {}) {
  const billing = {
    catalog: () => ({
      consultation: [{ minutes: 10, priceToman: 250_000, active: true }],
      subscriptions: [{ feature: 'ai_chat', prices: { 1: 1, 3: 2, 12: 3 } }],
    }),
  } as unknown as BillingService;
  const notifications = {
    list: async () => [{ notificationId: 'n1', titleFa: 'خرید ثبت شد' }],
    markRead: async () => undefined,
    ...overrides.notifications,
  } as unknown as NotificationService;
  const wallet = { ...overrides.wallet } as unknown as WalletService;
  return new ClientController(wallet, billing, {} as ConsultationQueueService, notifications);
}

describe('ClientController', () => {
  it('returns notifications as an array, not an unresolved promise', async () => {
    const res = await build().inbox(user);
    expect(Array.isArray(res.notifications)).toBe(true);
    expect(res.notifications).toHaveLength(1);
  });

  it('waits for mark-as-read and surfaces its failure', async () => {
    const failing = build({ notifications: { markRead: async () => Promise.reject(new Error('db down')) } });
    await expect(failing.read(user, { notificationIds: ['n1'] } as never)).rejects.toThrow('db down');
  });

  it('offers consultation plans only; AI subscriptions are not sold to clients', () => {
    const c = build().catalog();
    expect(c.consultation).toHaveLength(1);
    expect(c.subscriptions).toEqual([]);
  });

  it('refuses subscription purchases with 409 SYSTEM_FEATURE_NOT_AVAILABLE', () => {
    let thrown: unknown;
    try {
      build().buySubscription({ feature: 'ai_chat', months: 1 } as never);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).getResponse()).toMatchObject({ code: 'SYSTEM_FEATURE_NOT_AVAILABLE' });
  });

  it('sends the gateway back to the client portal', async () => {
    const topupStart = jest.fn(async () => ({ sessionId: 's1', redirectUrl: 'https://pay/s1' }));
    const prev = process.env.APP_URL;
    process.env.APP_URL = 'https://office.example/';
    try {
      await build({ wallet: { topupStart } as never }).topup(user, { amountToman: 50_000 } as never);
    } finally {
      process.env.APP_URL = prev;
    }
    expect(topupStart).toHaveBeenCalledWith('u1', 50_000, 'https://office.example/portal/?topup=return');
  });
});
