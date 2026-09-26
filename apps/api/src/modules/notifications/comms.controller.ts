import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { toLatinDigits } from '@legal-platform/shared';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';
import { UserRole } from '@legal-platform/domain';
import { AuditService } from '../audit/audit.service';
import { CommsSettingsService, SMS_PANEL_PROVIDERS, type SmsPanelProvider } from './comms-settings.service';

class SmsPanelDto {
  @ApiProperty({ enum: SMS_PANEL_PROVIDERS })
  @IsIn(SMS_PANEL_PROVIDERS)
  provider!: SmsPanelProvider;

  @ApiPropertyOptional({ description: 'Gateway URL override; the provider’s official endpoint when omitted' })
  @IsString()
  @IsOptional()
  baseUrl?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  apiKey!: string;

  @ApiPropertyOptional({ example: '10008663' })
  @IsString()
  @IsOptional()
  senderLine?: string;
}

class CallPanelDto {
  @ApiProperty({ example: 'https://my-callbox.example/api' })
  @IsString()
  @IsNotEmpty()
  baseUrl!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  authToken!: string;

  @ApiProperty({ description: 'Landline in national format, e.g. 021XXXXXXXX' })
  @Matches(/^[0-9+]{8,15}$/)
  fromNumber!: string;
}

class TestSmsDto {
  @ApiProperty({ description: 'Iranian mobile number: 11 digits starting with 09' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? toLatinDigits(value).trim() : value))
  @Matches(/^0?9\d{9}$/)
  to!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  text?: string;
}

class TestCallDto {
  @ApiProperty({ description: 'Iranian mobile number: 11 digits starting with 09' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? toLatinDigits(value).trim() : value))
  @Matches(/^0?9\d{9}$/)
  to!: string;
}

/**
 * The wired-office (P2a): the lawyer brings THEIR SMS panel and THEIR call
 * server; until one is plugged, the whole comms layer tells the truth
 * ("not connected") instead of reporting deliveries that never happened (SPEC §2).
 */
@ApiTags('comms')
@Controller('dashboard/comms')
@UseGuards(JwtAccessGuard, RolesGuard)
export class CommsController {
  constructor(
    private readonly comms: CommsSettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get('view')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'SMS and call panel settings (keys masked)' })
  view() {
    return this.comms.view();
  }

  @Post('sms')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Connect the office SMS panel (Kavenegar or Ghasedak); all platform SMS then use it' })
  async setSms(@Body() dto: SmsPanelDto, @CurrentUser() user: AuthenticatedUser) {
    await this.comms.setSmsPanel(dto, user.id);
    await this.audit.log({ actorId: user.id, action: 'comms.sms.configured', module: 'comms', entityType: 'sms_panel', entityId: dto.provider, metadata: {}, result: 'success' });
    return this.comms.view();
  }

  @Post('sms/test')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Send a real test SMS through the configured panel; returns latency or the error' })
  testSms(@Body() dto: TestSmsDto) {
    return this.comms.testSms(dto.to, dto.text ?? 'پلتفرم حقوقی: اتصال پنل پیامک دفتر برقرار است.');
  }

  @Post('call')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Configure the call panel; without it, up-next clients get an SMS instead of a call' })
  async setCall(@Body() dto: CallPanelDto, @CurrentUser() user: AuthenticatedUser) {
    await this.comms.setCallPanel(dto, user.id);
    await this.audit.log({ actorId: user.id, action: 'comms.call.configured', module: 'comms', entityType: 'call_panel', entityId: dto.accountId, metadata: {}, result: 'success' });
    return this.comms.view();
  }

  @Post('call/test')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Place a test call through the configured call panel' })
  testCall(@Body() dto: TestCallDto) {
    return this.comms.testCall(dto.to);
  }
}
