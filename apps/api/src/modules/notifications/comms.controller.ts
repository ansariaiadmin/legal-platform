import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';
import { UserRole } from '@legal-platform/domain';
import { AuditService } from '../audit/audit.service';
import { CommsSettingsService } from './comms-settings.service';

class SmsPanelDto {
  @ApiProperty({ enum: ['kavenegar', 'ghasedak', 'smsir', 'custom'] })
  @IsIn(['kavenegar', 'ghasedak', 'smsir', 'custom'])
  provider!: 'kavenegar' | 'ghasedak' | 'smsir' | 'custom';

  @ApiProperty({ example: 'https://api.kavenegar.com' })
  @IsString()
  @IsNotEmpty()
  baseUrl!: string;

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

  @ApiProperty({ example: '02112345678' })
  @Matches(/^[0-9+]{8,15}$/)
  fromNumber!: string;
}

class TestSmsDto {
  @ApiProperty({ example: '09123456789' })
  @Matches(/^0?9\d{9}$/)
  to!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  text?: string;
}

class TestCallDto {
  @ApiProperty({ example: '09123456789' })
  @Matches(/^0?9\d{9}$/)
  to!: string;
}

/**
 * The wired-office (P2a): the lawyer brings THEIR SMS panel and THEIR call
 * server; until one is plugged, the whole comms layer tells the truth
 * ("نامتصل") instead of green-lighting fake deliveries (SPEC §2).
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
  @ApiOperation({ summary: 'Comms state — masked keys, configured-or-honestly-empty' })
  view() {
    return this.comms.view();
  }

  @Post('sms')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Wire the SMS panel (Kavenegar/Ghasedak/…/custom)' })
  async setSms(@Body() dto: SmsPanelDto, @CurrentUser() user: AuthenticatedUser) {
    await this.comms.setSmsPanel(dto, user.id);
    await this.audit.log({ actorId: user.id, action: 'comms.sms.configured', module: 'comms', entityType: 'sms_panel', entityId: dto.provider, metadata: {}, result: 'success' });
    return this.comms.view();
  }

  @Post('sms/test')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Send a REAL test SMS through the wired panel — honest latency/error back' })
  testSms(@Body() dto: TestSmsDto) {
    return this.comms.testSms(dto.to, dto.text ?? 'پلتفرم حقوقی: تست اتصال ✅');
  }

  @Post('call')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Wire the call panel — الكلمة: بدون آن نوبت «تماس جعلی» نمی‌شود' })
  async setCall(@Body() dto: CallPanelDto, @CurrentUser() user: AuthenticatedUser) {
    await this.comms.setCallPanel(dto, user.id);
    await this.audit.log({ actorId: user.id, action: 'comms.call.configured', module: 'comms', entityType: 'call_panel', entityId: dto.accountId, metadata: {}, result: 'success' });
    return this.comms.view();
  }

  @Post('call/test')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Real outbound test call via the wired panel' })
  testCall(@Body() dto: TestCallDto) {
    return this.comms.testCall(dto.to);
  }
}
