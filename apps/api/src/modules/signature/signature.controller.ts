import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { RolesGuard, Roles } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';
import { UserRole } from '@legal-platform/domain';
import { SignatureService } from './signature.service';

const MIN_KEY_PASSWORD = 12;

@ApiTags('signature')
@ApiBearerAuth()
@Controller('signature')
@UseGuards(JwtAccessGuard, RolesGuard)
export class SignatureController {
  constructor(private readonly sig: SignatureService) {}

  @Post('keypair')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Generate (or replace) the caller\'s RSA-2048 signing key' })
  async generateKeypair(@CurrentUser() user: AuthenticatedUser, @Body('password') password: string) {
    if (typeof password !== 'string' || password.length < MIN_KEY_PASSWORD) {
      throw new BadRequestException({ code: 'WEAK_KEY_PASSWORD', message: `رمز کلید باید دست‌کم ${MIN_KEY_PASSWORD} نویسه باشد.` });
    }
    return this.sig.generateKeyPair(user.id, password);
  }

  @Get('public-key/:userId')
  @ApiOperation({ summary: 'Public key of a signer' })
  async getPublicKey(@Param('userId') userId: string) {
    const key = await this.sig.getPublicKey(userId);
    if (!key) return { found: false };
    return { found: true, ...key };
  }

  @Post('sign')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Sign a document with the caller\'s stored key (SHA-256 + RSA)' })
  async sign(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { documentId?: string; documentContent?: string; password?: string; signerName?: string },
    @Req() req: Request,
  ) {
    if (!body?.documentId || typeof body.documentContent !== 'string' || !body.password) {
      throw new BadRequestException({ code: 'INVALID_INPUT', message: 'شناسهٔ سند، متن سند و رمز کلید الزامی است.' });
    }
    return this.sig.sign({
      documentId: body.documentId,
      documentContent: body.documentContent,
      signerId: user.id,
      signerName: body.signerName || user.id,
      password: body.password,
      ip: req.ip ?? 'unknown',
      userAgent: req.get('user-agent') ?? 'unknown',
    });
  }

  @Post('verify/:signatureId')
  @ApiOperation({ summary: 'Verify a signature against the document content' })
  async verify(@Param('signatureId') signatureId: string, @Body('documentContent') documentContent: string) {
    return this.sig.verify(signatureId, documentContent);
  }

  @Get('document/:documentId')
  @ApiOperation({ summary: 'Signatures of a document' })
  async listForDoc(@Param('documentId') documentId: string) {
    return { signatures: await this.sig.listForDocument(documentId) };
  }

  @Get('my')
  @ApiOperation({ summary: 'Signatures made by the caller' })
  async mySignatures(@CurrentUser() user: AuthenticatedUser) {
    return { signatures: await this.sig.listBySigner(user.id) };
  }

  @Post('revoke/:signatureId')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Revoke a signature (for example after a key compromise)' })
  async revoke(@Param('signatureId') signatureId: string, @Body('reason') reason: string) {
    return this.sig.revoke(signatureId, reason || 'revoked by the office owner');
  }

  @Get('stats')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Signature statistics' })
  stats() {
    return this.sig.stats();
  }
}
