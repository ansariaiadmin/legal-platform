import { WalletService } from '../../src/modules/billing/wallet.service';
import { BillingService } from '../../src/modules/billing/billing.service';
import { ConsultationQueueService } from '../../src/modules/consultation/queue.service';
import { NotificationService } from '../../src/modules/notifications/notification.service';
import { CommsSettingsService } from '../../src/modules/notifications/comms-settings.service';
import { MockPaymentAdapter } from '../../src/providers/payment/mock-payment.adapter';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';
import type { SmsProvider } from '../../src/providers/sms/sms.provider';

/**
 * A restart must never lose a paid purchase or the lawyer's prices: the wallet
 * is debited in durable storage, so the purchase record has to be durable too.
 */

function memStorage(): StorageProvider {
  const store = new Map<string, Buffer>();
  return {
    put: async ({ key, content }) => {
      store.set(key, Buffer.isBuffer(content) ? content : Buffer.from(content));
    },
    get: async (key) => {
      const v = store.get(key);
      if (!v) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return v;
    },
    delete: async (key) => {
      store.delete(key);
    },
    list: async () => [...store.keys()],
    verifyConfig: async () => true,
    getMetadata: async () => null,
  } as StorageProvider;
}

const silentSms = {
  sendSms: async () => ({ success: true, providerMessageId: 'm1' }),
  sendOtp: async () => ({ success: true }),
  sendVerificationCode: async () => ({ success: true }),
  sendTemplatedSms: async () => ({ success: true }),
  verifyConfig: async () => ({ valid: true }),
  getMetadata: () => ({ name: 'silent-mock', supportedTypes: ['sms'] }),
} as unknown as SmsProvider;

/** One "process": services wired over shared durable storage. */
async function boot(storage: StorageProvider, payment: MockPaymentAdapter) {
  const wallet = new WalletService(payment, storage);
  const billing = new BillingService(wallet, storage);
  await billing.onModuleInit();
  const comms = new CommsSettingsService(storage);
  const notifications = new NotificationService(silentSms, storage, comms);
  const queue = new ConsultationQueueService(billing, notifications, storage);
  return { wallet, billing, queue };
}

describe('billing persistence across restarts', () => {
  it('keeps purchases, consumption and refunds after a restart', async () => {
    const storage = memStorage();
    const payment = new MockPaymentAdapter();
    const first = await boot(storage, payment);
    const { sessionId } = await first.wallet.topupStart('u1', 500_000, 'http://x/portal/?topup=return');
    await first.wallet.topupConfirm('u1', sessionId);
    await first.queue.setOnline(true);
    const purchase = await first.billing.buyConsultation('u1', 10, 'wallet');
    const ticket = await first.queue.join('u1', '09120000000', purchase.id);
    await first.queue.settled();

    // restart: fresh services over the same storage
    const second = await boot(storage, payment);
    const restored = second.billing.getPurchase(purchase.id);
    expect(restored).toMatchObject({ id: purchase.id, userId: 'u1', consumed: true });

    const before = (await second.wallet.state('u1')).balanceToman;
    const res = await second.queue.cancel('u1', ticket.ticketId);
    await second.queue.settled();
    expect(res.refunded).toBe(true);
    expect((await second.wallet.state('u1')).balanceToman).toBe(before + purchase.priceToman);

    // a third boot sees the refund flag, so the purchase cannot be refunded twice
    const third = await boot(storage, payment);
    expect(third.billing.getPurchase(purchase.id)?.refunded).toBe(true);
  });

  it("keeps the lawyer's consultation prices after a restart", async () => {
    const storage = memStorage();
    const payment = new MockPaymentAdapter();
    const first = await boot(storage, payment);
    first.billing.setPlans([
      { minutes: 10, priceToman: 777_000, active: true },
      { minutes: 20, priceToman: 1_200_000, active: false },
    ]);
    await first.billing.flush();

    const second = await boot(storage, payment);
    expect(second.billing.getPlans()).toEqual([
      { minutes: 10, priceToman: 777_000, active: true },
      { minutes: 20, priceToman: 1_200_000, active: false },
    ]);
    expect(second.billing.catalog().consultation.map((p) => p.minutes)).toEqual([10]);
  });

  it('works without storage (unit-test wiring) and starts from defaults', async () => {
    const billing = new BillingService(new WalletService(new MockPaymentAdapter(), memStorage()));
    await billing.onModuleInit();
    await billing.flush();
    expect(billing.getPlans().length).toBeGreaterThan(0);
  });
});
