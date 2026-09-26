import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ConsultationMinutes, TelecomsState, TicketStatus } from '@legal-platform/domain';
import { BillingService } from '../billing/billing.service';
import { InProcessAgentEventBus } from '../orchestrator/agent-event-bus';
import { NotificationService } from '../notifications/notification.service';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';

const APP_URL = process.env.APP_URL ?? '';
const QUEUE_KEY = 'runtime/consultation/queue.json';
const TELECOMS_KEY = 'runtime/consultation/telecoms.json';

export interface QueueTicket {
  ticketId: string;
  userId: string;
  phone: string;
  purchaseId: string;
  minutes: ConsultationMinutes;
  status: TicketStatus;
  joinedAt: string;
  /** when the lawyer called the ticket to the (mock) bridge */
  upNextAt?: string;
  inCallAt?: string;
  endedAt?: string;
  cancelledAt?: string;
  refundIssued?: boolean;
}

export interface QueuePosition {
  ticket: QueueTicket;
  position: number; // 1-based among waiting
  waitingAhead: number;
  /** sum of slot minutes of everyone ahead — honest estimate */
  etaMinutes: number;
  lawyerOnline: boolean;
  queueOpen: boolean;
}

/**
 * THE TELECOMS BOX (P2a): the lawyer is the station operator. Online/offline
 * is one switch; the queue opens and closes the same way; plan durations and
 * prices come from the dashboard. Every movement is emitted on the agent bus
 * so the Activity tab shows the line.
 *
 * Queue and telecoms state are persisted through the StorageProvider
 * (`runtime/consultation/*.json`), so a restart never drops waiting clients.
 */
@Injectable()
export class ConsultationQueueService {
  private readonly logger = new Logger(ConsultationQueueService.name);
  private tickets: QueueTicket[] = [];
  private telecoms: TelecomsState = {
    online: false,
    queueOpen: true,
    updatedAt: new Date().toISOString(),
  };
  private loaded = false;
  /** Notifications are sent in the background; tracked so failures are logged, never unhandled. */
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly billing: BillingService,
    private readonly notifications: NotificationService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Optional() private readonly bus?: InProcessAgentEventBus,
  ) {}

  /** Resolves once every background notification has finished (used by tests and graceful shutdown). */
  async settled(): Promise<void> {
    await Promise.all([...this.inflight]);
  }

  private background(task: Promise<void>): void {
    const tracked: Promise<void> = task
      .catch((err: unknown) => this.logger.warn(`notification failed: ${(err as Error)?.message ?? String(err)}`))
      .finally(() => this.inflight.delete(tracked));
    this.inflight.add(tracked);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const rawQueue = await this.storage.get(QUEUE_KEY);
      this.tickets = JSON.parse(rawQueue.toString('utf8')) as QueueTicket[];
    } catch {
      this.tickets = [];
    }
    try {
      const rawTelecoms = await this.storage.get(TELECOMS_KEY);
      this.telecoms = JSON.parse(rawTelecoms.toString('utf8')) as TelecomsState;
    } catch {
      // first boot — defaults
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await Promise.all([
      this.storage.put({
        key: QUEUE_KEY,
        content: Buffer.from(JSON.stringify(this.tickets)),
        contentType: 'application/json',
        metadata: { kind: 'consultation-queue' },
      }),
      this.storage.put({
        key: TELECOMS_KEY,
        content: Buffer.from(JSON.stringify(this.telecoms)),
        contentType: 'application/json',
        metadata: { kind: 'consultation-telecoms' },
      }),
    ]);
  }

  // ---- lawyer side --------------------------------------------------------

  async telecomsState(): Promise<TelecomsState> {
    await this.ensureLoaded();
    return { ...this.telecoms };
  }

  async setOnline(online: boolean): Promise<TelecomsState> {
    await this.ensureLoaded();
    this.telecoms = { ...this.telecoms, online, updatedAt: new Date().toISOString() };
    await this.persist();
    this.emit('queue.updated', `وکیل ${online ? 'آنلاین' : 'آفلاین'} شد.`);
    return { ...this.telecoms };
  }

  async setQueueOpen(open: boolean, reason?: string): Promise<TelecomsState> {
    await this.ensureLoaded();
    this.telecoms = { ...this.telecoms, queueOpen: open, closeReason: open ? undefined : (reason ?? 'ظرفیت مشاوره در حال حاضر تکمیل است.'), updatedAt: new Date().toISOString() };
    await this.persist();
    this.emit('queue.updated', open ? 'صف باز شد.' : `صف بسته شد: ${this.telecoms.closeReason}`);
    return { ...this.telecoms };
  }

  async list(statuses?: TicketStatus[]): Promise<QueueTicket[]> {
    await this.ensureLoaded();
    return this.tickets.filter((t) => !statuses || statuses.includes(t.status));
  }

  async waiting(): Promise<QueueTicket[]> {
    await this.ensureLoaded();
    return this.tickets.filter((t) => t.status === 'waiting' || t.status === 'up_next');
  }

  /** "Call the next client": the lawyer pulls the line. */
  async next(): Promise<QueueTicket | null> {
    await this.ensureLoaded();
    const current = this.tickets.find((t) => t.status === 'in_call' || t.status === 'up_next');
    if (current) await this.endTicket(current.ticketId, 'done');
    const nextWaiting = this.tickets.find((t) => t.status === 'waiting');
    if (!nextWaiting) return null;
    nextWaiting.status = 'up_next';
    nextWaiting.upNextAt = new Date().toISOString();
    await this.persist();
    this.emit('queue.updated', `نوبت ${nextWaiting.ticketId.slice(0, 8)} رسید.`);
    this.logger.log(`ticket ${nextWaiting.ticketId} is up_next`);
    this.background(this.notifications.upNext(nextWaiting, `${APP_URL.replace(/\/+$/, '')}/portal/`));
    const afterThem = this.tickets.find((t) => t.ticketId !== nextWaiting.ticketId && t.status === 'waiting');
    if (afterThem) this.background(this.notifications.almostThere(afterThem));
    return nextWaiting;
  }

  async skip(ticketId: string): Promise<QueueTicket> {
    await this.ensureLoaded();
    const t = this.need(ticketId);
    if (t.status !== 'waiting' && t.status !== 'up_next') {
      throw this.wrongState('فقط نوبت‌های در انتظار را می‌توان جابه‌جا کرد.');
    }
    // re-push to the END: honest reorder, no deletion
    const idx = this.tickets.indexOf(t);
    this.tickets.splice(idx, 1);
    this.tickets.push({ ...t, status: 'waiting' });
    await this.persist();
    this.emit('queue.updated', `نوبت ${ticketId.slice(0, 8)} به انتهای صف منتقل شد.`);
    return this.need(ticketId);
  }

  async endTicket(ticketId: string, endAs: 'done' | 'no_show'): Promise<void> {
    await this.ensureLoaded();
    const t = this.need(ticketId, true);
    if (t && (t.status === 'in_call' || t.status === 'up_next')) {
      t.status = endAs;
      t.endedAt = new Date().toISOString();
      await this.persist();
      this.emit('queue.updated', `نوبت ${ticketId.slice(0, 8)} → ${endAs}`);
    }
  }

  // ---- client side --------------------------------------------------------

  /** Join with a paid consultation purchase. */
  async join(userId: string, phone: string, purchaseId: string): Promise<QueueTicket> {
    await this.ensureLoaded();
    if (!this.telecoms.queueOpen) {
      const err = new Error(this.telecoms.closeReason ?? 'صف مشاوره در حال حاضر بسته است.');
      (err as Error & { code: string }).code = 'QUEUE_CLOSED';
      throw err;
    }
    if (!this.telecoms.online) {
      const err = new Error('وکیل در حال حاضر آنلاین نیست. وقتی آنلاین شود، می‌توانید وارد صف شوید.');
      (err as Error & { code: string }).code = 'LAWYER_OFFLINE';
      throw err;
    }
    const purchase = this.billing.getPurchase(purchaseId);
    if (!purchase || purchase.userId !== userId) {
      throw new BadRequestException({ code: 'PURCHASE_NOT_FOUND', message: 'چنین خریدی برای حساب شما ثبت نشده است.' });
    }
    if (purchase.kind !== 'consultation' || purchase.minutes === undefined) {
      throw new BadRequestException({ code: 'VALIDATION_INVALID_INPUT', message: 'این خرید مربوط به مشاوره نیست.' });
    }
    if (purchase.consumed) {
      throw new BadRequestException({ code: 'VALIDATION_INVALID_INPUT', message: 'از این خرید قبلاً استفاده شده است.' });
    }

    const ticket: QueueTicket = {
      ticketId: randomUUID(),
      userId,
      phone,
      purchaseId,
      minutes: purchase.minutes,
      status: 'waiting',
      joinedAt: new Date().toISOString(),
    };
    this.tickets.push(ticket);
    await this.persist();
    this.billing.markConsumed(purchaseId);
    await this.billing.flush();
    this.emit('queue.updated', `نوبت جدید ${ticket.ticketId.slice(0, 8)} (${ticket.minutes} دقیقه)`);
    this.logger.log(`ticket joined: ${ticket.ticketId} for ${userId}`);
    // The buyer learns their place in line immediately.
    const pos = await this.position(userId);
    if (pos) this.background(this.notifications.queuePosition(ticket, pos.position, pos.etaMinutes));
    return ticket;
  }

  async position(userId: string): Promise<QueuePosition | null> {
    await this.ensureLoaded();
    const mine = this.tickets.find((t) => t.userId === userId && (t.status === 'waiting' || t.status === 'up_next' || t.status === 'in_call'));
    if (!mine) return null;
    const queue = this.tickets.filter((t) => t.status === 'waiting' || t.status === 'up_next');
    const position = queue.findIndex((t) => t.ticketId === mine.ticketId) + 1;
    const ahead = queue.slice(0, Math.max(0, position - 1));
    const etaMinutes = ahead.reduce((sum, t) => sum + t.minutes, 0);
    return {
      ticket: mine,
      position: position || 1,
      waitingAhead: ahead.length,
      etaMinutes,
      lawyerOnline: this.telecoms.online,
      queueOpen: this.telecoms.queueOpen,
    };
  }

  async myTickets(userId: string): Promise<QueueTicket[]> {
    await this.ensureLoaded();
    return this.tickets.filter((t) => t.userId === userId);
  }

  /** Client cancels while still waiting → wallet refund, no questions asked. */
  async cancel(userId: string, ticketId: string): Promise<{ refunded: boolean }> {
    await this.ensureLoaded();
    const t = this.need(ticketId);
    if (t.userId !== userId) {
      throw new BadRequestException({ code: 'TICKET_NOT_FOUND', message: 'این نوبت متعلق به حساب شما نیست.' });
    }
    if (t.status !== 'waiting') {
      throw this.wrongState('فقط نوبت در انتظار را می‌توان لغو کرد.');
    }
    t.status = 'cancelled';
    t.cancelledAt = new Date().toISOString();
    const purchase = this.billing.getPurchase(t.purchaseId);
    if (purchase && !purchase.refunded) {
      t.refundIssued = true;
      await this.billing.refundPurchase(userId, t.purchaseId, `بازگشت وجه لغو نوبت ${t.ticketId.slice(0, 8)}`);
    }
    await this.persist();
    this.emit('queue.updated', `نوبت ${ticketId.slice(0, 8)} لغو شد و وجه آن بازگشت.`);
    return { refunded: Boolean(t.refundIssued) };
  }

  /** Call bridge: the lawyer (or the notification engine) starts the call. */
  async startCall(ticketId: string): Promise<QueueTicket> {
    await this.ensureLoaded();
    const t = this.need(ticketId);
    if (t.status !== 'up_next') {
      throw this.wrongState('هنوز نوبت این مراجعه‌کننده نرسیده است.');
    }
    t.status = 'in_call';
    t.inCallAt = new Date().toISOString();
    await this.persist();
    this.emit('queue.updated', `تماس برای نوبت ${ticketId.slice(0, 8)} آغاز شد.`);
    return t;
  }

  private need(ticketId: string, lenient = false): QueueTicket {
    const t = this.tickets.find((x) => x.ticketId === ticketId);
    if (!t && !lenient) {
      throw new BadRequestException({ code: 'TICKET_NOT_FOUND', message: 'نوبت پیدا نشد.' });
    }
    return t as QueueTicket;
  }

  private wrongState(message: string): BadRequestException {
    return new BadRequestException({ code: 'TICKET_WRONG_STATUS', message });
  }

  private emit(kind: string, detail: string) {
    this.bus?.emit({
      kind: 'queue.updated',
      at: new Date().toISOString(),
      taskId: `queue-${randomUUID().slice(0, 8)}`,
      agentId: 'legal-leader',
      detail: `${kind}: ${detail}`,
    });
  }
}
