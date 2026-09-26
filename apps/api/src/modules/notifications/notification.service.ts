import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SMS_PROVIDER, STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { SmsProvider } from '../../providers/sms/sms.provider';
import type { StorageProvider } from '../../providers/storage/storage.provider';
import { CommsSettingsService } from './comms-settings.service';
import type { QueueTicket } from '../consultation/queue.service';

export interface Notification {
  notificationId: string;
  userId: string;
  kind: 'queue_position' | 'queue_up_next' | 'subscription' | 'payment' | 'system';
  titleFa: string;
  bodyFa: string;
  channels: Array<'in_app' | 'sms' | 'call'>;
  delivered: { sms?: boolean; inApp: boolean };
  at: string;
  read: boolean;
}

const CAP = 50; // per-user notifications
const INBOX_KEY = 'runtime/notifications/inbox.json';

/**
 * Notification fanout (P2a): EVERY ticket motion reaches the client through
 * in-app + (if the lawyer wired their panel) SMS. Up-next ALSO dials an
 * outbound call via the telephony port — when the panel
 * isn't connected the event is still recorded with delivered.call=false and
 * never PRETENDS the phone rang.
 *
 * The inbox is persisted through the StorageProvider
 * (`runtime/notifications/inbox.json`), so notifications survive restarts.
 */

/** Persian digits for SMS and in-app text. */
const fa = (n: number): string => n.toLocaleString('fa-IR');

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private inbox = new Map<string, Notification[]>();
  private loaded = false;

  constructor(
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly comms: CommsSettingsService,
  ) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.storage.get(INBOX_KEY);
      const parsed = JSON.parse(raw.toString('utf8')) as Record<string, Notification[]>;
      this.inbox = new Map(Object.entries(parsed));
    } catch {
      // empty inbox is honest first state
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const obj = Object.fromEntries(this.inbox.entries());
    await this.storage.put({
      key: INBOX_KEY,
      content: Buffer.from(JSON.stringify(obj)),
      contentType: 'application/json',
      metadata: { kind: 'notifications-inbox' },
    });
  }

  async list(userId: string, unreadOnly = false): Promise<Notification[]> {
    await this.ensureLoaded();
    const arr = this.inbox.get(userId) ?? [];
    return unreadOnly ? arr.filter((n) => !n.read) : arr;
  }

  async markRead(userId: string, notificationIds: string[]): Promise<void> {
    await this.ensureLoaded();
    const arr = this.inbox.get(userId) ?? [];
    for (const n of arr) if (notificationIds.includes(n.notificationId)) n.read = true;
    await this.persist();
  }

  /** Position after join or reorder: place in line and estimated wait. */
  async queuePosition(ticket: QueueTicket, position: number, etaMinutes: number): Promise<void> {
    await this.push(ticket.userId, {
      kind: 'queue_position',
      titleFa: position === 1 ? 'شما نفر بعدی هستید' : `جایگاه شما در صف: ${fa(position)}`,
      bodyFa: `نوبت ${ticket.ticketId.slice(0, 8)}: ${position === 1 ? 'شما نفر بعدی هستید.' : `${fa(position - 1)} نفر پیش از شما هستند.`} زمان تقریبی انتظار ${fa(etaMinutes)} دقیقه است (مشاورهٔ ${fa(ticket.minutes)} دقیقه‌ای).`,
      channels: ['in_app', 'sms'],
    }, ticket.phone);
  }

  /** Sent when the client moves up to second place in line. */
  async almostThere(ticket: QueueTicket): Promise<void> {
    await this.push(ticket.userId, {
      kind: 'queue_position',
      titleFa: 'نوبت شما نزدیک است',
      bodyFa: `نوبت ${ticket.ticketId.slice(0, 8)}: فقط یک نفر پیش از شماست. لطفاً برای تماس وکیل آماده باشید.`,
      channels: ['in_app', 'sms'],
    }, ticket.phone);
  }

  /** Purchase receipt pushed into the inbox. */
  async pushPayment(userId: string, minutes: number, amountToman: number): Promise<void> {
    await this.push(userId, {
      kind: 'payment',
      titleFa: 'خرید ثبت شد',
      bodyFa: `مشاورهٔ ${fa(minutes)} دقیقه‌ای به مبلغ ${amountToman.toLocaleString('fa-IR')} تومان خریداری شد. هر زمان بخواهید می‌توانید وارد صف شوید.`,
      channels: ['in_app'],
    });
  }

  /**
   * Up-next: SMS + dial out. The telephony call goes through the LAWYER'S
   * panel (their own call server) — when none is configured we say so.
   */
  async upNext(ticket: QueueTicket, consultUrl: string): Promise<void> {
    const smsCfg = this.comms.getSms();
    const callCfg = this.comms.getCall();
    let callPlaced = false;

    if (callCfg) {
      try {
        const res = await fetch(`${callCfg.baseUrl.replace(/\/$/, '')}/calls`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Account-Id': callCfg.accountId,
            'X-Auth-Token': callCfg.authToken,
          },
          body: JSON.stringify({ to: ticket.phone, from: callCfg.fromNumber, consultUrl, ticket: ticket.ticketId }),
          signal: AbortSignal.timeout(6000),
        });
        callPlaced = res.ok;
      } catch (err) {
        this.logger.warn(`call panel dial failed: ${(err as Error).message}`);
      }
    }

    await this.push(ticket.userId, {
      kind: 'queue_up_next',
      titleFa: '🔔 نوبت شما رسید',
      bodyFa: callPlaced
        ? `وکیل آمادهٔ مشاوره با شماست و به‌زودی تماس می‌گیرد. وضعیت نوبت: ${consultUrl}`
        : `نوبت شما رسید. وکیل به‌زودی با شمارهٔ ثبت‌شده تماس می‌گیرد. وضعیت نوبت: ${consultUrl}`,
      channels: callPlaced ? ['in_app', 'sms', 'call'] : ['in_app', 'sms'],
    }, ticket.phone);

    if (!smsCfg && !callCfg) {
      this.logger.log(`up_next for ${ticket.ticketId} — no comms panels wired; in-app only`);
    }
  }

  private async push(
    userId: string,
    payload: Omit<Notification, 'notificationId' | 'userId' | 'at' | 'read' | 'delivered'>,
    phone?: string,
  ): Promise<void> {
    // Load the persisted inbox first; otherwise the first push after a restart
    // would overwrite everything that was stored before it.
    await this.ensureLoaded();
    const n: Notification = {
      notificationId: randomUUID(),
      userId,
      at: new Date().toISOString(),
      read: false,
      delivered: { sms: false, inApp: true },
      ...payload,
    };
    const arr = this.inbox.get(userId) ?? [];
    arr.push(n);
    if (arr.length > CAP) arr.splice(0, arr.length - CAP);
    this.inbox.set(userId, arr);
    await this.persist();

    if (phone && payload.channels.includes('sms')) {
      try {
        const r = await this.sms.sendSms({ phone, message: `${n.titleFa}\n${n.bodyFa}` });
        n.delivered.sms = Boolean(r.success);
        await this.persist();
      } catch (err) {
        this.logger.warn(`SMS failed: ${(err as Error).message}`);
      }
    }
  }
}
