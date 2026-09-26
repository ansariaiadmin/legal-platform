import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@legal-platform/domain';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';
import { SetupWizardService, type WizardStepId } from './setup.service';

@ApiTags('setup')
@ApiBearerAuth()
@Controller('dashboard/setup')
@UseGuards(JwtAccessGuard, RolesGuard)
export class SetupController {
  constructor(private readonly wizard: SetupWizardService) {}

  @Get()
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Wizard state: progress, current step and defaults' })
  status() {
    return this.wizard.status();
  }

  @Post('start')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Start or resume the setup wizard' })
  start(@CurrentUser() user: AuthenticatedUser) {
    return this.wizard.start(user.id);
  }

  @Post('advance')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Complete the current wizard step (configuration steps require a payload)' })
  advance(@Body() body: { stepId: WizardStepId; payload?: Record<string, unknown> }, @CurrentUser() user: AuthenticatedUser) {
    return this.wizard.advance(body.stepId, body.payload ?? {}, user.id);
  }

  @Post('finish')
  @Roles(UserRole.LAWYER_OWNER)
  finish(@CurrentUser() user: AuthenticatedUser) {
    return this.wizard.finish(user.id);
  }

  @Delete()
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Reset the setup wizard (owner only)' })
  reset() {
    return this.wizard.reset().then(() => ({ reset: true }));
  }
}
