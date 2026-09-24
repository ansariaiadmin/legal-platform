import { Body, Controller, Get, Param, Post, UseGuards, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { RolesGuard, Roles } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';
import { UserRole } from '@legal-platform/domain';
import { SignatureService } from './signature.service';

@ApiTags('signature')
@ApiBearerAuth()
@Controller('signature')
@UseGuards(JwtAccessGuard, RolesGuard)
export class SignatureController {
  constructor(private readonly sig: SignatureService) {}

  @Post('keypair')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'ساخت کلید امضای الکترونیک — RSA 2048 — برای وکیل' })
  async generateKeypair(@CurrentUser() user: AuthenticatedUser, @Body('password') password: string) {
    if (!password || password.length < 8) {
      return { error: 'رمز کلید حداقل ۸ کاراکتر' };
    }
    return this.sig.generateKeyPair(user.id, password);
  }

  @Get('public-key/:userId')
  @ApiOperation({ summary: 'کلید عمومی وکیل — برای تایید امضا' })
  async getPublicKey(@Param('userId') userId: string) {
    const key = await this.sig.getPublicKey(userId);
    if (!key) return { found: false };
    return { found: true, ...key };
  }

  @Post('sign')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'امضای سند/پیش‌نویس — با کلید خصوصی — هش SHA256 + زمان‌مهر' })
  async sign(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { documentId: string; documentContent: string; privateKey: string; password: string; signerName: string },
    @Req() req: any,
  ) {
    return this.sig.sign({
      documentId: body.documentId,
      documentContent: body.documentContent,
      signerId: user.id,
      signerName: body.signerName || user.id,
      privateKey: body.privateKey,
      password: body.password,
      ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });
  }

  @Post('verify/:signatureId')
  @ApiOperation({ summary: 'تایید امضای الکترونیک — بررسی هش + کلید عمومی' })
  async verify(@Param('signatureId') signatureId: string, @Body('documentContent') documentContent: string) {
    return this.sig.verify(signatureId, documentContent);
  }

  @Get('document/:documentId')
  @ApiOperation({ summary: 'لیست امضاهای یک سند' })
  async listForDoc(@Param('documentId') documentId: string) {
    return { signatures: await this.sig.listForDocument(documentId) };
  }

  @Get('my')
  @ApiOperation({ summary: 'امضاهای من' })
  async mySignatures(@CurrentUser() user: AuthenticatedUser) {
    return { signatures: await this.sig.listBySigner(user.id) };
  }

  @Post('revoke/:signatureId')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'ابطال امضا — در صورت لو رفتن کلید' })
  async revoke(@Param('signatureId') signatureId: string, @Body('reason') reason: string) {
    return this.sig.revoke(signatureId, reason || 'ابطال توسط مالک');
  }

  @Get('stats')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'آمار امضاها' })
  stats() {
    return this.sig.stats();
  }
}
