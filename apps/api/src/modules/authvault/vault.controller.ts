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
  @ApiOperation({ summary: 'Lock status of each protected area' })
  areas() {
    return this.locks.status();
  }

  @Post('areas/:area/password')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Set or change an area password (at least 8 characters; existing tickets are revoked)' })
  setAreaPassword(
    @Param('area') area: string,
    @Body() body: { password: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.locks.setPassword(assertArea(area), body?.password ?? '', user.id);
  }

  @Post('areas/:area/disable')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Remove an area lock (existing tickets are revoked)' })
  disableArea(@Param('area') area: string, @CurrentUser() user: AuthenticatedUser) {
    return this.locks.disable(assertArea(area), user.id);
  }

  @Post('areas/:area/unlock')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Exchange the area password for a 12-hour ticket (rate-limited)' })
  unlock(@Param('area') area: string, @Body() body: { password: string }, @Ip() ip: string) {
    return this.locks.unlock(assertArea(area), body?.password ?? '', ip);
  }

  /* ---------------- passkeys ---------------- */

  @Post('passkeys/register/begin')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Start passkey registration (single-use challenge, valid 5 minutes)' })
  beginRegister(@CurrentUser() user: AuthenticatedUser) {
    return this.passkeys.begin(user.id, 'register');
  }

  @Post('passkeys/register/finish')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Finish passkey registration and store the validated P-256 public key' })
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
  @ApiOperation({ summary: 'Age of each secret class, with rotation reminders' })
  advice() {
    return this.rotation.advice();
  }

  @Post('rotation/rotate-all')
  @AreaLocked('vault')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Rotate every platform-owned credential; returns the new credentials once' })
  rotateAll(@CurrentUser() user: AuthenticatedUser) {
    return this.rotation.rotateAll(user.id);
  }

  @Post('rotation/rotate-all/download')
  @AreaLocked('vault')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Rotate all credentials and download the credentials file' })
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
