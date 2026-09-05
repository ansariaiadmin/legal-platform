import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MachineOnly, MachineScope, MachineTokenGuard, MachineTokenInfo } from './machine-token.guard';
import type { MachineToken } from './machine-tokens.service';

/**
 * Platform-agnostic surface PROBE (P5): external clients (mini-app, scripts)
 * authenticate with `Bearer lpm_...`; the response carries the PRINCIPAL the
 * token resolved to — never more. A real read for `client:read` so the whole
 * gated surface has a provable, minimal landing spot.
 */
@ApiTags('ext')
@Controller('ext')
export class ExtPingController {
  @Get('ping')
  @UseGuards(MachineTokenGuard)
  @MachineScope('client:read')
  @MachineOnly()
  @ApiOperation({ summary: 'machine-token health ping: who am I with this token?' })
  ping(@MachineTokenInfo() token: MachineToken | undefined) {
    return {
      ok: true,
      service: 'legal-platform-ext',
      principal: token ? { tokenId: token.tokenId, label: token.label, scopes: token.scopes } : null,
      at: new Date().toISOString(),
    };
  }
}
