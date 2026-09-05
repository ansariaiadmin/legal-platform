import { Body, Controller, Get, Ip, Param, Post, Res, UseGuards } from '@nestjs/common';
import { AreaLockGuard, AreaLocked } from './area-lock.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRole } from '@legal-platform/domain';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';
import { AreaLockService, LOCKED_AREAS, type LockedArea } from './area-lock.service';
import { PasskeysService } from './passkeys.service';
import { RotationService } from './rotation.service';

/**
 * P8 vault panel APIs — everything the dashboard's password & security desk
 * needs: area locks, passkeys (WebAuthn), rotation bot, one-shot credentials
 * download. OWNER-only for mutations; status/advice readable by STAFF so the
 * office sees the reminders without holding the keys.
 */
@ApiTags('vault')
@ApiBearerAuth()
@Controller('dashboard/vault')
@UseGuards(JwtAccessGuard, RolesGuard, AreaLockGuard)
export class VaultController {
  constructor(
    private readonly locks: AreaLockService,
    private readonly passkeys: PasskeysService,
    private readonly rotation: RotationService,
  ) {}

  /* ---------------- area locks ---------------- */

  @Get('areas')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'lock status of each protected area' })
  areas() {
    return this.locks.status();
  }

  @Post('areas/:area/password')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'set/rotate an area password (scrypt; min 8 chars; old tickets die via epoch bump)' })
  setAreaPassword(
    @Param('area') area: string,
    @Body() body: { password: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.locks.setPassword(assertArea(area), body?.password ?? '', user.id);
  }

  @Post('areas/:area/disable')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'unlock an area (existing tickets die too — epoch bump)' })
  disableArea(@Param('area') area: string, @CurrentUser() user: AuthenticatedUser) {
    return this.locks.disable(assertArea(area), user.id);
  }

  @Post('areas/:area/unlock')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'trade the area password for a 12h HMAC ticket (rate-limited, one-shot locks on abuse)' })
  unlock(@Param('area') area: string, @Body() body: { password: string }, @Ip() ip: string) {
    return this.locks.unlock(assertArea(area), body?.password ?? '', ip);
  }

  /* ---------------- passkeys ---------------- */

  @Post('passkeys/register/begin')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'WebAuthn registration ceremony: server challenge (5min, one-shot)' })
  beginRegister(@CurrentUser() user: AuthenticatedUser) {
    return this.passkeys.begin(user.id, 'register');
  }

  @Post('passkeys/register/finish')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'finish passkey registration: one-shot challenge + validated P-256 public key persisted' })
  finishRegister(
    @Body() body: { challengeId: string; credentialId: string; publicKeyB64: string; deviceLabel?: string },
  ) {
    return this.passkeys.finishRegistration(body);
  }

  @Post('passkeys/login/begin')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  beginLogin(@CurrentUser() user: AuthenticatedUser) {
    return this.passkeys.begin(user.id, 'login');
  }

  @Post('passkeys/login/finish')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  finishLogin(
    @Body()
    body: {
      challengeId: string;
      credentialId: string;
      authenticatorDataB64: string;
      clientDataJSONB64: string;
      signatureB64: string;
      newCounter: number;
    },
  ) {
    return this.passkeys.finishLogin(body);
  }

  @Get('passkeys')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  listPasskeys(@CurrentUser() user: AuthenticatedUser) {
    return this.passkeys.listFor(user.id);
  }

  @Post('passkeys/:credentialId/revoke')
  @Roles(UserRole.LAWYER_OWNER)
  revokePasskey(@Param('credentialId') credentialId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.passkeys.removeCredential(user.id, credentialId);
  }

  /* ---------------- rotation bot ---------------- */

  @Get('rotation/advice')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'staleness per secret class with Persian hints — the reminder robot' })
  advice() {
    return this.rotation.advice();
  }

  @Post('rotation/rotate-all')
  @AreaLocked('vault')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'ONE button: rotate every platform-owned credential; returns the ONE-SHOT credentials file' })
  rotateAll(@CurrentUser() user: AuthenticatedUser) {
    return this.rotation.rotateAll(user.id);
  }

  @Post('rotation/rotate-all/download')
  @AreaLocked('vault')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'rotate-all AND download the credentials file as an attachment, in one move' })
  async rotateAllAndDownload(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const result = await this.rotation.rotateAll(user.id);
    res
      .setHeader('Content-Type', 'text/plain; charset=utf-8')
      .setHeader('Content-Disposition', 'attachment; filename="legal-platform-credentials.txt"')
      .send(result.credentialsFile);
    return;
  }
}

function assertArea(area: string): LockedArea {
  if ((LOCKED_AREAS as readonly string[]).includes(area)) return area as LockedArea;
  throw Object.assign(new Error(`unknown area: ${area}`), { code: 'VALIDATION_INVALID_INPUT' });
}
