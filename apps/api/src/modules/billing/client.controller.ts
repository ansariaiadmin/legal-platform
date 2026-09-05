import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';
import { UserRole, SubscriptionFeature, type ConsultationMinutes } from '@legal-platform/domain';
import { WalletService } from './wallet.service';
import { BillingService } from './billing.service';
import { ConsultationQueueService } from '../consultation/queue.service';
import { NotificationService } from '../notifications/notification.service';

class TopupDto {
  @ApiProperty({ example: 500_000 })
  @IsInt()
  @Min(10_000)
  amountToman!: number;
}

class BuyConsultationDto {
  @ApiProperty({ enum: [10, 20, 30] })
  @IsIn([10, 20, 30])
  minutes!: ConsultationMinutes;

  @ApiPropertyOptional({ enum: ['wallet', 'gateway'], default: 'wallet' })
  @IsIn(['wallet', 'gateway'])
  @IsOptional()
  payWith?: 'wallet' | 'gateway';
}

class BuySubscriptionDto {
  @ApiProperty({ enum: Object.values(SubscriptionFeature) })
  @IsIn(Object.values(SubscriptionFeature))
  feature!: SubscriptionFeature;

  @ApiProperty({ enum: [1, 3, 12] })
  @IsInt()
  months!: number;

  @ApiPropertyOptional({ enum: ['wallet', 'gateway'], default: 'wallet' })
  @IsIn(['wallet', 'gateway'])
  @IsOptional()
  payWith?: 'wallet' | 'gateway';
}

class JoinQueueDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  purchaseId!: string;

  @ApiProperty({ example: '0912...' })
  @IsString()
  @IsNotEmpty()
  phone!: string;
}

class MarkReadDto {
  @ApiProperty({ type: [String] })
  @IsString({ each: true })
  notificationIds!: string[];
}

/**
 * The PUBLIC site surface (P2a): what the client PWA calls. Wallet top-up,
 * direct purchase, queue join/position/cancel, notifications — all owner of
 * "کاربر ورودی" flows that pair with lawyer-side telecoms.
 */
@ApiTags('client')
@Controller('client')
@UseGuards(JwtAccessGuard, RolesGuard)
export class ClientController {
  constructor(
    private readonly wallet: WalletService,
    private readonly billing: BillingService,
    private readonly queue: ConsultationQueueService,
    private readonly notifications: NotificationService,
  ) {}

  // —— catalog + wallet ——

  @Get('catalog')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Everything buyable: consultation plans + AI subscriptions' })
  catalog() {
    return { ...this.billing.catalog(), comms: {} };
  }

  @Get('wallet')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'My wallet: balance + recent txns' })
  async myWallet(@CurrentUser() user: AuthenticatedUser) {
    const s = await this.wallet.state(user.id);
    return { balanceToman: s.balanceToman, txns: s.txns.slice(-20).reverse() };
  }

  @Post('wallet/topup')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Start a wallet top-up — gateway session' })
  topup(@CurrentUser() user: AuthenticatedUser, @Body() dto: TopupDto) {
    return this.wallet.topupStart(user.id, dto.amountToman, `${process.env.APP_URL ?? ''}/client/wallet/verify`);
  }

  @Post('wallet/topup/confirm')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Confirm a paid session credits the wallet (idempotent)' })
  topupConfirm(@CurrentUser() user: AuthenticatedUser, @Body('sessionId') sessionId: string) {
    return this.wallet.topupConfirm(user.id, sessionId);
  }

  // —— purchases ——

  @Post('purchases/consultation')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Buy a 10/20/30-minute consultation slot' })
  async buyConsultation(@CurrentUser() user: AuthenticatedUser, @Body() dto: BuyConsultationDto) {
    const purchase = await this.billing.buyConsultation(user.id, dto.minutes, dto.payWith ?? 'wallet');
    void this.notifications.pushPayment?.(user.id, dto.minutes, purchase.priceToman);
    return purchase;
  }

  @Post('purchases/subscription')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Subscribe to an AI feature (per-part pricing)' })
  buySubscription(@CurrentUser() user: AuthenticatedUser, @Body() dto: BuySubscriptionDto) {
    return this.billing.buySubscription(user.id, dto.feature, dto.months, dto.payWith ?? 'wallet');
  }

  @Get('subscription-status/:feature')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Do I have an active subscription for this AI feature?' })
  mySubscription(@CurrentUser() user: AuthenticatedUser, @Param('feature') feature: string) {
    const f = feature as SubscriptionFeature;
    return { feature: f, active: this.billing.hasActive(user.id, f), subscriptions: this.billing.subscriptionsOf(user.id).filter((s) => s.feature === f) };
  }

  @Get('my-purchases')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'What I bought that is still unconsumed' })
  myPurchases(@CurrentUser() user: AuthenticatedUser) {
    return { consultations: this.billing.consultationPurchases(user.id) };
  }

  // —— the queue ——

  @Post('queue/join')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Join the consultation line with a purchased slot' })
  join(@CurrentUser() user: AuthenticatedUser, @Body() dto: JoinQueueDto) {
    const ticket = this.queue.join(user.id, dto.phone, dto.purchaseId);
    const pos = this.queue.position(user.id);
    return { ticket, position: pos };
  }

  @Get('queue/me')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Where am I in line + honest ETA' })
  myPosition(@CurrentUser() user: AuthenticatedUser) {
    return { position: this.queue.position(user.id), telecoms: this.queue.telecomsState() };
  }

  @Post('queue/cancel/:ticketId')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Cancel my waiting ticket — money returns to wallet' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('ticketId') ticketId: string) {
    return this.queue.cancel(user.id, ticketId);
  }

  // —— notifications ——

  @Get('notifications')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'My notification inbox (in-app + SMS copy)' })
  inbox(@CurrentUser() user: AuthenticatedUser, @Query('unread') unread?: string) {
    return { notifications: this.notifications.list(user.id, unread === 'true') };
  }

  @Post('notifications/read')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Mark notifications read' })
  read(@CurrentUser() user: AuthenticatedUser, @Body() dto: MarkReadDto) {
    this.notifications.markRead(user.id, dto.notificationIds);
    return { ok: true };
  }
}
