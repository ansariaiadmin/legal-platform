import { ConfigService } from '@nestjs/config';
import { WalletService } from '../../src/modules/billing/wallet.service';
import { BillingService } from '../../src/modules/billing/billing.service';
import { ConsultationQueueService } from '../../src/modules/consultation/queue.service';
import { NotificationService } from '../../src/modules/notifications/notification.service';
import { CommsSettingsService } from '../../src/modules/notifications/comms-settings.service';
import { MockPaymentAdapter } from '../../src/providers/payment/mock-payment.adapter';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';
import type { SmsProvider } from '../../src/providers/sms/sms.provider';

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
  };
}

// Records every SMS so tests can assert on traffic
function spyingSms() {
  const sent: Array<{ phone: string; text: string }> = [];
  const sms: SmsProvider = {
    sendSms: async ({ phone, message }) => {
      sent.push({ phone, text: message });
      return { success: true, providerMessageId: 'm1' };
    },
    sendOtp: async () => ({ success: true }),
    sendVerificationCode: async () => ({ success: true }),
    sendTemplatedSms: async () => ({ success: true }),
    verifyConfig: async () => ({ valid: true }),
    getMetadata: () => ({ name: 'spying-mock', supportedTypes: ['sms'] }),
  } as unknown as SmsProvider;
  return { sms, sent };
}

async function bootstrap() {
  const payment = new MockPaymentAdapter();
  const storage = memStorage();
  const wallet = new WalletService(payment, storage);
  const billing = new BillingService(wallet);
  const { sms, sent } = spyingSms();
  const comms = new CommsSettingsService(storage);
  const notifications = new NotificationService(sms, comms);
  const queue = new ConsultationQueueService(billing, notifications, undefined);
  return { payment, storage, wallet, billing, notifications, queue, comms, sent };
}

async function fundWallet(wallet: WalletService, userId: string, amount: number) {
  const { sessionId } = await wallet.topupStart(userId, amount, 'http://x/cb');
  return wallet.topupConfirm(userId, sessionId); // mock adapter; dev marks paid
}

describe('wallet (P2a)', () => {
  it('topup → confirm credits balance once (idempotent on the same session)', async () => {
    const { wallet } = await bootstrap();
    await fundWallet(wallet, 'u1', 500_000);
    const state = await wallet.state('u1');
    expect(state.balanceToman).toBe(500_000);
    // replay the same session a second time — must NOT double-credit
    const again = await wallet.topupConfirm('u1', (await wallet.state('u1')).txns.at(-1)!.externalRef!);
    expect(again.credited).toBe(false);
    expect((await wallet.state('u1')).balanceToman).toBe(500_000);
  });

  it('debit below balance throws WALLET_INSUFFICIENT_FUNDS, balance untouched', async () => {
    const { wallet } = await bootstrap();
    await fundWallet(wallet, 'u1', 100_000);
    await expect(wallet.debit('u1', 250_000, 'purchase', 'test')).rejects.toThrow('کافی نیست');
    expect((await wallet.state('u1')).balanceToman).toBe(100_000);
  });

  it('wallet state survives a FRESH service instance — persisted via StorageProvider', async () => {
    const storage = memStorage();
    const payment = new MockPaymentAdapter();
    const before = new WalletService(payment, storage);
    await fundWallet(before, 'u1', 120_000);
    const after = new WalletService(payment, storage); // restart simulation
    expect((await after.state('u1')).balanceToman).toBe(120_000);
  });
});

describe('billing catalog & purchases (P2a)', () => {
  it('catalog ships 10/20/30 plans + all four AI subscription features', async () => {
    const { billing } = await bootstrap();
    const c = billing.catalog();
    expect(c.consultation.map((p) => p.minutes).sort()).toEqual([10, 20, 30]);
    expect(c.subscriptions).toHaveLength(4);
  });

  it('buyConsultation via wallet debits and creates an unconsumed purchase', async () => {
    const { wallet, billing } = await bootstrap();
    await fundWallet(wallet, 'u1', 1_000_000);
    const p = await billing.buyConsultation('u1', 20, 'wallet');
    expect(p.minutes).toBe(20);
    expect(p.consumed).toBe(false);
    expect((await wallet.state('u1')).balanceToman).toBe(550_000); // 1_000_000 − 450_000
  });

  it('duplicate ACTIVE subscription for a feature is refused', async () => {
    const { wallet, billing } = await bootstrap();
    await fundWallet(wallet, 'u1', 2_000_000);
    await billing.buySubscription('u1', 'ai_chat' as never, 1, 'wallet');
    await expect(billing.buySubscription('u1', 'ai_chat' as never, 1, 'wallet')).rejects.toThrow('فعال است');
  });

  it('lawyer edits plans — only 10/20/30 tolerated', async () => {
    const { billing } = await bootstrap();
    billing.setPlans([
      { minutes: 10, priceToman: 100_000, active: true },
      { minutes: 30, priceToman: 300_000, active: true },
      { minutes: 20, priceToman: 0, active: false },
    ]);
    const c = billing.catalog();
    expect(c.consultation.map((p) => p.minutes)).toEqual([10, 30]); // 20 inactive, hidden
    expect(() => billing.setPlans([{ minutes: 25 as never, priceToman: 1, active: true }])).toThrow('۱۰/۲۰/۳۰');
  });
});

describe('the consultation queue (P2a)', () => {
  async function paidTicketInLine(queue: ConsultationQueueService, billing: BillingService, wallet: WalletService, userId: string, minutes: 10 | 20 | 30, phone: string) {
    await fundWallet(wallet, userId, 2_000_000);
    queue.setOnline(true);
    const purchase = await billing.buyConsultation(userId, minutes, 'wallet');
    return queue.join(userId, phone, purchase.id);
  }

  it('join → SMS «نفر اولی» (or N-nth) with honest ETA', async () => {
    const { wallet, billing, queue, sent } = await bootstrap();
    const t1 = await paidTicketInLine(queue, billing, wallet, 'u1', 20, '09120000001');
    const t2 = await paidTicketInLine(queue, billing, wallet, 'u2', 10, '09120000002');
    expect(queue.position('u2')!.position).toBe(2);
    expect(queue.position('u2')!.etaMinutes).toBe(20);
    expect(sent.some((s) => s.phone === '09120000001' && s.text.includes('نفر'))).toBe(true);
    expect(sent.some((s) => s.phone === '09120000002' && s.text.includes('20 دقیقه'))).toBe(true);
    expect(t1.status).toBe('waiting');
    expect(t2.status).toBe('waiting');
  });

  it('queue CLOSED → QUEUE_CLOSED; offline lawyer → LAWYER_OFFLINE', async () => {
    const { wallet, billing, queue } = await bootstrap();
    queue.setQueueOpen(false, 'مرخصی امروز');
    await fundWallet(wallet, 'u1', 2_000_000);
    const p = await billing.buyConsultation('u1', 10, 'wallet');
    expect(() => queue.join('u1', '0912', p.id)).toThrow('مرخصی امروز');
    queue.setQueueOpen(true);
    queue.setOnline(false);
    expect(() => queue.join('u1', '0912', p.id)).toThrow('آفلاین');
  });

  it('same purchase cannot re-join (consumed marked), next() sends up_next SMS to the caller then «نزدیک می‌شی» to the second', async () => {
    const { wallet, billing, queue, sent } = await bootstrap();
    await paidTicketInLine(queue, billing, wallet, 'u1', 10, '09120000001');
    await paidTicketInLine(queue, billing, wallet, 'u2', 10, '09120000002');
    const purchase = await billing.buyConsultation('u1', 10, 'wallet');
    queue.join('u1', '09120000001', purchase.id);
    const dup = await billing.getPurchase(purchase.id);
    expect(dup!.consumed).toBe(true);
    expect(() => queue.join('u1', '09120000001', purchase.id)).toThrow('قبلاً مصرف شده');
    sent.length = 0;
    const up = queue.next()!;
    expect(up.status).toBe('up_next');
    expect(sent.some((s) => s.text.includes('نوبت توئه'))).toBe(true);
    expect(sent.some((s) => s.phone === '09120000002' && s.text.includes('نزدیک'))).toBe(true);
  });

  it('cancel refunds wallet; ticket leaves the line', async () => {
    const { wallet, billing, queue } = await bootstrap();
    await paidTicketInLine(queue, billing, wallet, 'u1', 10, '09120000001');
    const before = (await wallet.state('u1')).balanceToman; // 1_750_000
    const t1 = queue.myTickets('u1')[0];
    const res = await queue.cancel('u1', t1.ticketId);
    expect(res.refunded).toBe(true);
    expect((await wallet.state('u1')).balanceToman).toBe(before + 250_000);
    const t_after = queue.myTickets('u1')[0];
    expect(t_after.status).toBe('cancelled');
  });

  it('skip pushes to the end — the q passes ONE', async () => {
    const { wallet, billing, queue } = await bootstrap();
    const t1 = await paidTicketInLine(queue, billing, wallet, 'u1', 10, '09120000001');
    await paidTicketInLine(queue, billing, wallet, 'u2', 10, '09120000002');
    queue.skip(t1.ticketId);
    expect(queue.position('u2')!.position).toBe(1);
    expect(queue.position('u1')!.position).toBe(2);
  });

  it('startCall → in_call; end → done; lifecycle respected', async () => {
    const { wallet, billing, queue } = await bootstrap();
    const t = await paidTicketInLine(queue, billing, wallet, 'u1', 10, '09120000001');
    expect(() => queue.startCall(t.ticketId)).toThrow('به نوبت');
    const up = queue.next()!;
    queue.startCall(up.ticketId);
    expect(queue.myTickets('u1')[0].status).toBe('in_call');
    queue.endTicket(up.ticketId, 'done');
    expect(queue.myTickets('u1')[0].status).toBe('done');
  });
});

describe('comms settings (P2a)', () => {
  it('view is HONESTLY unconfigured before wiring; after wiring, secrets are masked', async () => {
    const { comms } = await bootstrap();
    expect((await comms.view()).sms.configured).toBe(false);
    await comms.setSmsPanel(
      { provider: 'kavenegar', baseUrl: 'https://api.kavenegar.com', apiKey: 'A1B2C3D4SECRETKEY99' },
      'owner',
    );
    const v = await comms.view();
    expect(v.sms.configured).toBe(true);
    expect(v.sms.apiKeyMasked).toBe('••••EY99');
    expect(JSON.stringify(v)).not.toContain('A1B2C3D4SECRETKEY99');
  });

  it('testSms without a panel responds with the honest “not wired” error', async () => {
    const { comms } = await bootstrap();
    const r = await comms.testSms('09120000000', '🧪');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('وصل نیست');
  });
});
