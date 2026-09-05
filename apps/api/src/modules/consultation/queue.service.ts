import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ConsultationMinutes, TelecomsState, TicketStatus } from '@legal-platform/domain';
import { BillingService } from '../billing/billing.service';
import { InProcessAgentEventBus } from '../orchestrator/agent-event-bus';
import { NotificationService } from '../notifications/notification.service';

const APP_URL = process.env.APP_URL ?? '';

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
 * is one thumb; the queue opens/closes the same way; دقیقه‌ی هر پلن از داشبورد
 * می‌آید. Every movement emits to the agent bus so the kitchen SEEs the line.
 */
@Injectable()
export class ConsultationQueueService {
  private readonly logger = new Logger(ConsultationQueueService.name);
  private readonly tickets: QueueTicket[] = [];
  private telecoms: TelecomsState = {
    online: false,
    queueOpen: true,
    updatedAt: new Date().toISOString(),
  };

  constructor(
    private readonly billing: BillingService,
    private readonly notifications: NotificationService,
    @Optional() private readonly bus?: InProcessAgentEventBus,
  ) {}

  // ---- lawyer side --------------------------------------------------------

  telecomsState(): TelecomsState {
    return { ...this.telecoms };
  }

  setOnline(online: boolean): TelecomsState {
    this.telecoms = { ...this.telecoms, online, updatedAt: new Date().toISOString() };
    this.emit('queue.updated', `وکیل ${online ? 'آنلاین' : 'آفلاین'} شد`);
    return this.telecomsState();
  }

  setQueueOpen(open: boolean, reason?: string): TelecomsState {
    this.telecoms = { ...this.telecoms, queueOpen: open, closeReason: open ? undefined : (reason ?? 'فعلاً ظرفیت تکمیل است'), updatedAt: new Date().toISOString() };
    this.emit('queue.updated', open ? 'صف باز شد' : `صف بسته شد: ${this.telecoms.closeReason}`);
    return this.telecomsState();
  }

  list(statuses?: TicketStatus[]): QueueTicket[] {
    return this.tickets.filter((t) => !statuses || statuses.includes(t.status));
  }

  waiting(): QueueTicket[] {
    return this.tickets.filter((t) => t.status === 'waiting' || t.status === 'up_next');
  }

  /** "یک نفر بعدی بفرست" — the lawyer pulls the line. */
  next(): QueueTicket | null {
    const current = this.tickets.find((t) => t.status === 'in_call' || t.status === 'up_next');
    if (current) this.endTicket(current.ticketId, 'done');
    const nextWaiting = this.tickets.find((t) => t.status === 'waiting');
    if (!nextWaiting) return null;
    nextWaiting.status = 'up_next';
    nextWaiting.upNextAt = new Date().toISOString();
    this.emit('queue.updated', `بلیت ${nextWaiting.ticketId.slice(0, 8)} به نوبت رسید`);
    this.logger.log(`ticket ${nextWaiting.ticketId} is up_next`);
    void this.notifications.upNext(nextWaiting, `${APP_URL}/call/${nextWaiting.ticketId}`);
    const afterThem = this.tickets.find((t) => t.ticketId !== nextWaiting.ticketId && t.status === 'waiting');
    if (afterThem) void this.notifications.almostThere(afterThem);
    return nextWaiting;
  }

  skip(ticketId: string): QueueTicket {
    const t = this.need(ticketId);
    if (t.status !== 'waiting' && t.status !== 'up_next') {
      throw this.wrongState('فقط نفرهای صف را می‌شود جابه‌جا کرد');
    }
    // re-push to the END: honest reorder, no deletion
    const idx = this.tickets.indexOf(t);
    this.tickets.splice(idx, 1);
    this.tickets.push({ ...t, status: 'waiting' });
    this.emit('queue.updated', `بلیت ${ticketId.slice(0, 8)} به ته صف رفت`);
    return this.need(ticketId);
  }

  endTicket(ticketId: string, endAs: 'done' | 'no_show'): void {
    const t = this.need(ticketId, true);
    if (t.status === 'in_call' || t.status === 'up_next') {
      t.status = endAs;
      t.endedAt = new Date().toISOString();
      this.emit('queue.updated', `بلیت ${ticketId.slice(0, 8)} → ${endAs}`);
    }
  }

  // ---- client side --------------------------------------------------------

  /** Join with a paid consultation purchase. */
  join(userId: string, phone: string, purchaseId: string): QueueTicket {
    if (!this.telecoms.queueOpen) {
      const err = new Error(this.telecoms.closeReason ?? 'صف بسته است');
      (err as Error & { code: string }).code = 'QUEUE_CLOSED';
      throw err;
    }
    if (!this.telecoms.online) {
      const err = new Error('وکیل فعلاً آفلاین است — وقتی آنلاین شد صف می‌آید.');
      (err as Error & { code: string }).code = 'LAWYER_OFFLINE';
      throw err;
    }
    const purchase = this.billing.getPurchase(purchaseId);
    if (!purchase || purchase.userId !== userId) {
      throw new BadRequestException({ code: 'PURCHASE_NOT_FOUND', message: 'چنین خریدی نداری' });
    }
    if (purchase.kind !== 'consultation' || purchase.minutes === undefined) {
      throw new BadRequestException({ code: 'VALIDATION_INVALID_INPUT', message: 'خرید مشاوره نیست' });
    }
    if (purchase.consumed) {
      throw new BadRequestException({ code: 'VALIDATION_INVALID_INPUT', message: 'این خرید قبلاً مصرف شده' });
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
    this.billing.markConsumed(purchaseId);
    this.emit('queue.updated', `بلیت جدید ${ticket.ticketId.slice(0, 8)} (${ticket.minutes} دقیقه)`);
    this.logger.log(`ticket joined: ${ticket.ticketId} for ${userId}`);
    // "خرید زدی → بگو نفر چندمی" — the buyer IMMEDIATELY learns their place.
    const pos = this.position(userId);
    if (pos) void this.notifications.queuePosition(ticket, pos.position, pos.etaMinutes);
    return ticket;
  }

  position(userId: string): QueuePosition | null {
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

  myTickets(userId: string): QueueTicket[] {
    return this.tickets.filter((t) => t.userId === userId);
  }

  /** Client cancels while still waiting → wallet refund, no questions asked. */
  async cancel(userId: string, ticketId: string): Promise<{ refunded: boolean }> {
    const t = this.need(ticketId);
    if (t.userId !== userId) {
      throw new BadRequestException({ code: 'TICKET_NOT_FOUND', message: 'بلیت مال تو نیست' });
    }
    if (t.status !== 'waiting') {
      throw this.wrongState('فقط بلیت در حال انتظار را می‌شود کنسل کرد');
    }
    t.status = 'cancelled';
    t.cancelledAt = new Date().toISOString();
    const purchase = this.billing.getPurchase(t.purchaseId);
    if (purchase && !purchase.refunded) {
      t.refundIssued = true;
      await this.billing.refundPurchase(userId, t.purchaseId, `انصراف از نوبت ${t.ticketId.slice(0, 8)}`);
    }
    this.emit('queue.updated', `بلیت ${ticketId.slice(0, 8)} کنسل و وجه برگشت`);
    return { refunded: Boolean(t.refundIssued) };
  }

  /** Call bridge: the lawyer (or the notification engine) starts the call. */
  startCall(ticketId: string): QueueTicket {
    const t = this.need(ticketId);
    if (t.status !== 'up_next') {
      throw this.wrongState('بلیت هنوز به نوبتش نرسیده');
    }
    t.status = 'in_call';
    t.inCallAt = new Date().toISOString();
    this.emit('queue.updated', `تماس با بلیت ${ticketId.slice(0, 8)} آغاز شد`);
    return t;
  }

  private need(ticketId: string, lenient = false): QueueTicket {
    const t = this.tickets.find((x) => x.ticketId === ticketId);
    if (!t && !lenient) {
      throw new BadRequestException({ code: 'TICKET_NOT_FOUND', message: 'بلیت پیدا نشد' });
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
