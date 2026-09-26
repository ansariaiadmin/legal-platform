import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@legal-platform/domain';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';
import { ALLOWED_SCOPES, MachineTokensService, type MachineTokenScope } from './machine-tokens.service';

/**
 * Issue / list / revoke machine tokens (P5-T3). The issued token string is
 * returned ONCE here; afterwards only the registry record exists.
 */
@ApiTags('machine-tokens')
@ApiBearerAuth()
@Controller('dashboard/machine-tokens')
@UseGuards(JwtAccessGuard, RolesGuard)
export class MachineTokensController {
  constructor(private readonly tokens: MachineTokensService) {}

  @Get()
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'List machine tokens, including revoked ones' })
  list() {
    return this.tokens.list();
  }

  @Get('scopes')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Allowed permission scopes' })
  scopes() {
    return { scopes: ALLOWED_SCOPES };
  }

  @Post()
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Issue a machine token (the token is shown only once)' })
  issue(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { label: string; scopes: MachineTokenScope[]; expiresInDays?: number },
  ) {
    return this.tokens.issue({ ...body, createdBy: user.id });
  }

  @Delete(':id')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Revoke a machine token immediately' })
  async revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { revoked: await this.tokens.revoke(id, user.id) };
  }
}
