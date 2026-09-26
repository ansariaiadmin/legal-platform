import { Body, Controller, Get, Logger, Param, Post, Query, UseGuards, ConflictException } from '@nestjs/common';
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
 * client-side flows that pair with the lawyer-side telecoms controls.
 */
@ApiTags('client')
@Controller('client')
@UseGuards(JwtAccessGuard, RolesGuard)
export class ClientController {
  private readonly logger = new Logger(ClientController.name);

  constructor(
    private readonly wallet: WalletService,
    private readonly billing: BillingService,
    private readonly queue: ConsultationQueueService,
    private readonly notifications: NotificationService,
  ) {}

  // —— catalog + wallet ——

  @Get('catalog')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'What a client can buy: the active consultation plans' })
  catalog() {
    // AI subscriptions are not offered to clients until the portal has
    // client-facing AI features to deliver; see buySubscription below.
    return { consultation: this.billing.catalog().consultation, subscriptions: [] };
  }

  @Get('wallet')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'My wallet: balance and recent transactions' })
  async myWallet(@CurrentUser() user: AuthenticatedUser) {
    const s = await this.wallet.state(user.id);
    return { balanceToman: s.balanceToman, txns: s.txns.slice(-20).reverse() };
  }

  @Post('wallet/topup')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Start a wallet top-up; returns the gateway URL to send the user to' })
  topup(@CurrentUser() user: AuthenticatedUser, @Body() dto: TopupDto) {
    // The gateway returns the user to the client portal, which then calls
    // wallet/topup/confirm with the Authority it received.
    const appUrl = (process.env.APP_URL ?? '').replace(/\/+$/, '');
    return this.wallet.topupStart(user.id, dto.amountToman, `${appUrl}/portal/?topup=return`);
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
    // The purchase is already committed; a failed notification must not fail
    // the request or surface as an unhandled rejection.
    this.notifications
      .pushPayment?.(user.id, dto.minutes, purchase.priceToman)
      ?.catch((err: unknown) => this.logger.warn(`payment notification failed: ${(err as Error).message}`));
    return purchase;
  }

  @Post('purchases/subscription')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Reserved: AI subscriptions are not sold to clients yet (409 SYSTEM_FEATURE_NOT_AVAILABLE)' })
  buySubscription(@Body() _dto: BuySubscriptionDto): never {
    // Never take money for something the portal cannot deliver.
    throw new ConflictException({
      code: 'SYSTEM_FEATURE_NOT_AVAILABLE',
      message: 'اشتراک امکانات هوش مصنوعی هنوز برای موکلان فعال نیست.',
    });
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
  async join(@CurrentUser() user: AuthenticatedUser, @Body() dto: JoinQueueDto) {
    const ticket = await this.queue.join(user.id, dto.phone, dto.purchaseId);
    const pos = await this.queue.position(user.id);
    return { ticket, position: pos };
  }

  @Get('queue/me')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'My queue position and estimated wait' })
  async myPosition(@CurrentUser() user: AuthenticatedUser) {
    return { position: await this.queue.position(user.id), telecoms: await this.queue.telecomsState() };
  }

  @Post('queue/cancel/:ticketId')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Cancel my waiting ticket; the price is refunded to the wallet' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('ticketId') ticketId: string) {
    return this.queue.cancel(user.id, ticketId);
  }

  // —— notifications ——

  @Get('notifications')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'My notifications (in-app, with SMS delivery status)' })
  async inbox(@CurrentUser() user: AuthenticatedUser, @Query('unread') unread?: string) {
    return { notifications: await this.notifications.list(user.id, unread === 'true') };
  }

  @Post('notifications/read')
  @Roles(UserRole.CLIENT, UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Mark notifications read' })
  async read(@CurrentUser() user: AuthenticatedUser, @Body() dto: MarkReadDto) {
    await this.notifications.markRead(user.id, dto.notificationIds);
    return { ok: true };
  }
}
