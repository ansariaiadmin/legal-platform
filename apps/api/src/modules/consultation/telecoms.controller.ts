import { Body, Controller, Get, Param, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';
import { UserRole, type ConsultationMinutes, type ConsultationPlan } from '@legal-platform/domain';
import { ConsultationQueueService } from './queue.service';
import { BillingService } from '../billing/billing.service';

class PlanDto {
  @ApiProperty({ enum: [10, 20, 30] })
  @IsIn([10, 20, 30])
  minutes!: ConsultationMinutes;

  @ApiProperty({ example: 250_000 })
  @IsInt()
  @Min(0)
  priceToman!: number;

  @ApiProperty()
  @IsBoolean()
  active!: boolean;
}

class PlansDto {
  @ApiProperty({ type: [PlanDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PlanDto)
  plans!: PlanDto[];
}

class CloseDto {
  @ApiPropertyOptional({ example: 'ظرفیت امروز تکمیل شد' })
  @IsString()
  @IsOptional()
  reason?: string;
}

class ToggleOnlineDto {
  @ApiProperty()
  @IsBoolean()
  online!: boolean;
}

/**
 * THE TELECOMS BOX (P2a) — dashboard side. One thumb: online ⇅ offline.
 * Another thumb: صف باز / بسته. The lawyer is the stationmaster; ملت فقط
 * سوار می‌شوند.
 */
@ApiTags('consultation-telecoms')
@Controller('dashboard/consultation')
@UseGuards(JwtAccessGuard, RolesGuard)
export class TelecomsController {
  constructor(
    private readonly queue: ConsultationQueueService,
    private readonly billing: BillingService,
  ) {}

  @Get('telecoms')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Lawyer telecoms state: online? queue open? next-up stats' })
  async state() {
    return {
      telecoms: await this.queue.telecomsState(),
      waitingCount: (await this.queue.waiting()).length,
      plans: this.billing.getPlans(),
    };
  }

  @Post('telecoms/online')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'The hukm spring — the lawyer goes on call' })
  async toggle(@Body() dto: ToggleOnlineDto) {
    return { telecoms: await this.queue.setOnline(dto.online) };
  }

  @Post('telecoms/queue/open')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Open the gate — clients may join the line' })
  async open() {
    return { telecoms: await this.queue.setQueueOpen(true) };
  }

  @Post('telecoms/queue/close')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Close the gate — the queue closes with a Persian reason' })
  async close(@Body() dto: CloseDto) {
    return { telecoms: await this.queue.setQueueOpen(false, dto.reason) };
  }

  @Post('telecoms/queue/next')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Call the next ticket — whoever is in_call ends done' })
  async next() {
    const t = await this.queue.next();
    if (!t) return { up: null, message: 'صف خالی است' };
    return { up: t };
  }

  @Post('telecoms/queue/skip/:ticketId')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Skip: push a ticket to the end of the line, honestly' })
  async skip(@Param('ticketId') ticketId: string) {
    return this.queue.skip(ticketId);
  }

  @Post('telecoms/queue/call/:ticketId')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Start the actual call for an up_next ticket' })
  async startCall(@Param('ticketId') ticketId: string) {
    return this.queue.startCall(ticketId);
  }

  @Post('telecoms/queue/end/:ticketId')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'End an in-call ticket: done or no_show' })
  async endCall(@Param('ticketId') ticketId: string, @Body('endAs') endAs: 'done' | 'no_show') {
    if (endAs !== 'done' && endAs !== 'no_show') {
      throw new BadRequestException({ code: 'VALIDATION_INVALID_INPUT', message: 'endAs باید done یا no_show باشد' });
    }
    await this.queue.endTicket(ticketId, endAs);
    return { ended: ticketId, as: endAs };
  }

  @Get('telecoms/queue')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'The whole line — for the dashboard board' })
  async board() {
    return {
      waiting: await this.queue.waiting(),
      current: await this.queue.list(['in_call']),
      doneToday: (await this.queue.list(['done'])).length,
      states: { noShow: (await this.queue.list(['no_show'])).length, cancelled: (await this.queue.list(['cancelled'])).length },
    };
  }

  @Post('telecoms/plans')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Edit the 10/20/30 plans — price Toman is YOURS' })
  setPlans(@Body() dto: PlansDto, @CurrentUser() user: AuthenticatedUser) {
    this.billing.setPlans(dto.plans as ConsultationPlan[]);
    return { plans: this.billing.getPlans(), updatedBy: user.id };
  }
}
