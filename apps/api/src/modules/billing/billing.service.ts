import { BadRequestException, Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CONSULTATION_PLANS,
  SubscriptionFeature,
  type ConsultationMinutes,
  type ConsultationPlan,
} from '@legal-platform/domain';
import { WalletService } from './wallet.service';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';

/** Storage key for plans, purchases and subscriptions (Postgres-backed in production). */
const BILLING_STATE_KEY = 'runtime/billing/state.json';

interface BillingState {
  plans: ConsultationPlan[];
  purchases: PurchaseRecord[];
  subscriptions: Array<[string, SubscriptionRecord[]]>;
}

/**
 * The sales room (P2a): the public site's money brain. Prices are presented
 * to clients; the LAWYER edits consultation plans from the dashboard telecoms
 * box — nothing money-shaped is hardcoded in a UI.
 */

export interface SubscriptionRecord {
  id: string;
  feature: SubscriptionFeature;
  months: number;
  priceToman: number;
  startedAt: string;
  expiresAt: string;
  active: boolean;
}

export interface PurchaseRecord {
  id: string;
  kind: 'consultation' | 'subscription';
  userId: string;
  /** consultation: minutes; subscription: feature */
  label: string;
  minutes?: ConsultationMinutes;
  feature?: SubscriptionFeature;
  priceToman: number;
  paidVia: 'wallet' | 'gateway';
  purchasedAt: string;
  consumed: boolean; // consultation: ticket was spent
  refunded?: boolean;
}

/** AI subscription prices, one subscription per feature (toman for 1, 3 and 12 months). */
const SUBSCRIPTION_PRICES: Record<SubscriptionFeature, { 1: number; 3: number; 12: number }> = {
  [SubscriptionFeature.AI_CHAT]: { 1: 120_000, 3: 310_000, 12: 1_100_000 },
  [SubscriptionFeature.AI_FILE_LAB]: { 1: 190_000, 3: 500_000, 12: 1_700_000 },
  [SubscriptionFeature.AI_KITCHEN]: { 1: 90_000, 3: 240_000, 12: 850_000 },
  [SubscriptionFeature.AI_VOICE]: { 1: 150_000, 3: 400_000, 12: 1_400_000 },
};

/**
 * Plans, purchases and subscriptions are kept in memory for fast reads and
 * written through to the StorageProvider on every change, so a restart never
 * loses a paid purchase or the lawyer's prices. State is loaded before the
 * application starts accepting requests (onModuleInit).
 */
@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);
  private plans: ConsultationPlan[] = [...DEFAULT_CONSULTATION_PLANS];
  private readonly subscriptions = new Map<string, SubscriptionRecord[]>();
  private readonly purchases = new Map<string, PurchaseRecord>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly wallet: WalletService,
    @Optional() @Inject(STORAGE_PROVIDER) private readonly storage?: StorageProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.storage) return;
    let raw: Buffer;
    try {
      raw = await this.storage.get(BILLING_STATE_KEY);
    } catch {
      return; // first boot: defaults
    }
    const state = JSON.parse(raw.toString('utf8')) as Partial<BillingState>;
    if (Array.isArray(state.plans) && state.plans.length) this.plans = state.plans;
    for (const p of state.purchases ?? []) this.purchases.set(p.id, p);
    for (const [userId, list] of state.subscriptions ?? []) this.subscriptions.set(userId, list);
    this.logger.log(`billing state loaded: ${this.purchases.size} purchases`);
  }

  /** Queue a write of the full state. Writes are serialised so none is lost. */
  private persist(): Promise<void> {
    if (!this.storage) return Promise.resolve();
    const storage = this.storage;
    const snapshot: BillingState = {
      plans: this.plans,
      purchases: [...this.purchases.values()],
      subscriptions: [...this.subscriptions.entries()],
    };
    const content = Buffer.from(JSON.stringify(snapshot));
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() =>
        storage
          .put({ key: BILLING_STATE_KEY, content, contentType: 'application/json', metadata: { kind: 'billing-state' } })
          .then(() => undefined),
      );
    this.writeChain.catch((err: unknown) => this.logger.error(`billing state write failed: ${(err as Error).message}`));
    return this.writeChain;
  }

  /** Resolves when every pending state write has finished. */
  async flush(): Promise<void> {
    await this.writeChain;
  }

  // ---- catalog ------------------------------------------------------------

  catalog() {
    return {
      consultation: this.plans.filter((p) => p.active),
      subscriptions: (Object.keys(SUBSCRIPTION_PRICES) as SubscriptionFeature[]).map((f) => ({
        feature: f,
        prices: SUBSCRIPTION_PRICES[f],
      })),
    };
  }

  setPlans(plans: ConsultationPlan[]) {
    for (const p of plans) {
      if (![10, 20, 30].includes(p.minutes)) {
        throw new BadRequestException({
          code: 'VALIDATION_INVALID_INPUT',
          message: 'فقط پلن‌های ۱۰، ۲۰ و ۳۰ دقیقه‌ای مجاز است.',
        });
      }
    }
    this.plans = plans.map((p) => ({ ...p }));
    void this.persist().catch(() => undefined);
  }

  getPlans(): ConsultationPlan[] {
    return this.plans;
  }

  // ---- purchases ----------------------------------------------------------

  buyConsultation(
    userId: string,
    minutes: ConsultationMinutes,
    payWith: 'wallet' | 'gateway',
  ): Promise<PurchaseRecord & { paymentRedirect?: string }> {
    const plan = this.plans.find((p) => p.minutes === minutes && p.active);
    if (!plan) {
      throw new BadRequestException({ code: 'VALIDATION_INVALID_INPUT', message: `پلن ${minutes} دقیقه‌ای فعال نیست.` });
    }
    return this.record(userId, {
      kind: 'consultation',
      label: `${minutes}-minute-consultation`,
      minutes,
      priceToman: plan.priceToman,
      payWith,
    });
  }

  async buySubscription(
    userId: string,
    feature: SubscriptionFeature,
    months: number,
    payWith: 'wallet' | 'gateway',
  ): Promise<SubscriptionRecord & { paymentRedirect?: string }> {
    const prices = SUBSCRIPTION_PRICES[feature];
    if (!prices) {
      throw new BadRequestException({ code: 'VALIDATION_INVALID_INPUT', message: 'نوع اشتراک معتبر نیست.' });
    }
    const price = (prices as Record<number, number>)[months];
    if (!price) {
      throw new BadRequestException({ code: 'VALIDATION_INVALID_INPUT', message: 'مدت اشتراک باید ۱، ۳ یا ۱۲ ماه باشد.' });
    }
    const dup = (this.subscriptions.get(userId) ?? []).find((s) => s.feature === feature && s.active && new Date(s.expiresAt) > new Date());
    if (dup) {
      const err = new Error('این اشتراک هم‌اکنون فعال است.');
      (err as Error & { code: string }).code = 'SUBSCRIPTION_ACTIVE';
      throw err;
    }
    return this.payForSubscription(userId, feature, months, price, payWith);
  }

  private async payForSubscription(
    userId: string,
    feature: SubscriptionFeature,
    months: number,
    priceToman: number,
    payWith: 'wallet' | 'gateway',
  ): Promise<SubscriptionRecord & { paymentRedirect?: string }> {
    let redirect: string | undefined;
    if (payWith === 'wallet') {
      await this.wallet.debit(userId, priceToman, 'subscription', `اشتراک ${months} ماههٔ ${feature}`);
    } else {
      redirect = `/client/mock-gate?amount=${priceToman}&purpose=subscription:${feature}:${months}`; // honest dev redirect
    }
    const now = Date.now();
    const rec: SubscriptionRecord = {
      id: randomUUID(),
      feature,
      months,
      priceToman,
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + months * 30 * 24 * 3600_000).toISOString(),
      active: payWith === 'wallet', // gateway starts only after verified callback
    };
    const list = this.subscriptions.get(userId) ?? [];
    list.push(rec);
    this.subscriptions.set(userId, list);
    await this.persist();
    this.logger.log(`subscription ${feature} x${months}m for ${userId} via ${payWith}`);
    return { ...rec, paymentRedirect: redirect };
  }

  private async record(
    userId: string,
    input: Omit<PurchaseRecord, 'id' | 'userId' | 'purchasedAt' | 'consumed' | 'paidVia'> & { payWith: 'wallet' | 'gateway' },
  ): Promise<PurchaseRecord & { paymentRedirect?: string }> {
    let redirect: string | undefined;
    if (input.payWith === 'wallet') {
      await this.wallet.debit(userId, input.priceToman, 'purchase', `خرید مشاورهٔ ${input.minutes} دقیقه‌ای`);
    } else {
      redirect = `/client/mock-gate?amount=${input.priceToman}&purpose=consultation:${input.minutes}`;
    }
    const rec: PurchaseRecord = {
      id: randomUUID(),
      userId,
      kind: input.kind,
      label: input.label,
      minutes: input.minutes,
      feature: input.feature,
      priceToman: input.priceToman,
      paidVia: input.payWith,
      purchasedAt: new Date().toISOString(),
      consumed: false,
    };
    this.purchases.set(rec.id, rec);
    await this.persist();
    return { ...rec, paymentRedirect: redirect };
  }

  consultationPurchases(userId: string): PurchaseRecord[] {
    return [...this.purchases.values()].filter((p) => p.userId === userId && p.kind === 'consultation');
  }

  getPurchase(purchaseId: string): PurchaseRecord | undefined {
    return this.purchases.get(purchaseId);
  }

  markConsumed(purchaseId: string): void {
    const p = this.purchases.get(purchaseId);
    if (!p) return;
    p.consumed = true;
    void this.persist().catch(() => undefined);
  }

  subscriptionsOf(userId: string): SubscriptionRecord[] {
    const now = new Date();
    return (this.subscriptions.get(userId) ?? []).map((s) => ({
      ...s,
      active: s.active && new Date(s.expiresAt) > now,
    }));
  }

  hasActive(userId: string, feature: SubscriptionFeature): boolean {
    return this.subscriptionsOf(userId).some((s) => s.feature === feature && s.active);
  }

  async refundPurchase(userId: string, purchaseId: string, note: string): Promise<void> {
    const p = this.purchases.get(purchaseId);
    if (!p || p.userId !== userId || p.refunded) return;
    p.refunded = true;
    await this.wallet.refund(userId, p.priceToman, note, purchaseId);
    await this.persist();
    this.logger.log(`refunded purchase ${purchaseId} to ${userId}`);
  }
}
