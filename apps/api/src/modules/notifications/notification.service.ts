import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SMS_PROVIDER } from '../../providers/provider.tokens';
import type { SmsProvider } from '../../providers/sms/sms.provider';
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

/**
 * Notification fanout (P2a): EVERY ticket motion reaches the client through
 * in-app + (if the lawyer wired their panel) SMS. Up-next ALSO dials an
 * outbound call ("وقتشه، بیا تو تماس") via telephony port — when the panel
 * isn't connected the event is still recorded with delivered.call=false and
 * never PRETENDS the phone rang.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly inbox = new Map<string, Notification[]>();

  constructor(
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly comms: CommsSettingsService,
  ) {}

  list(userId: string, unreadOnly = false): Notification[] {
    const arr = this.inbox.get(userId) ?? [];
    return unreadOnly ? arr.filter((n) => !n.read) : arr;
  }

  markRead(userId: string, notificationIds: string[]): void {
    const arr = this.inbox.get(userId) ?? [];
    for (const n of arr) if (notificationIds.includes(n.notificationId)) n.read = true;
  }

  /** Position after join / reorder: "نفر Nم هستی، حدود M دقیقه" */
  async queuePosition(ticket: QueueTicket, position: number, etaMinutes: number): Promise<void> {
    await this.push(ticket.userId, {
      kind: 'queue_position',
      titleFa: `نفر ${position}ام هستی`,
      bodyFa: `بلیت ${ticket.ticketId.slice(0, 8)} → ${position === 1 ? 'نفر بعدی تویی!' : `${position - 1} نفر جلوت هستند؛`} حدود ${etaMinutes} دقیقه صبر (${ticket.minutes} دقیقه نوبت خودت).`,
      channels: ['in_app', 'sms'],
    }, ticket.phone);
  }

  /** «به نوبتت نزدیک میشی» — when position shrinks to N سېcond or first. */
  async almostThere(ticket: QueueTicket): Promise<void> {
    await this.push(ticket.userId, {
      kind: 'queue_position',
      titleFa: 'به نوبتت داری نزدیک می‌شی!',
      bodyFa: `بلیت ${ticket.ticketId.slice(0, 8)} — فقط یک نفر مونده؛ آماده باش تا وکیل صدات کنه.`,
      channels: ['in_app', 'sms'],
    }, ticket.phone);
  }

  /** Purchase receipt pushed into the inbox. */
  async pushPayment(userId: string, minutes: number, amountToman: number): Promise<void> {
    await this.push(userId, {
      kind: 'payment',
      titleFa: 'خرید ثبت شد ✅',
      bodyFa: `وقت ${minutes} دقیقه‌ای به مبلغ ${amountToman.toLocaleString('fa-IR')} تومان خریدی. وقتی بخواهی وارد صف شو.`,
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
      titleFa: '🔔 نوبت توئه!',
      bodyFa: callPlaced
        ? `وکیل تو را صدا زد. لینک مشاوره: ${consultUrl}`
        : `نوبت توئه ولی پنل تماس وصل نشده — از داخل اپ بپیوند: ${consultUrl}`,
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

    if (phone && payload.channels.includes('sms')) {
      try {
        const r = await this.sms.sendSms({ phone, message: `${n.titleFa}\n${n.bodyFa}` });
        n.delivered.sms = Boolean(r.success);
      } catch (err) {
        this.logger.warn(`SMS failed: ${(err as Error).message}`);
      }
    }
  }
}
