import { Body, Controller, Get, HttpCode, HttpStatus, Ip, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RefreshTokenDto, RequestOtpDto, VerifyOtpDto } from './dto/auth.dto';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Request a login OTP for an Iranian mobile number' })
  @ApiResponse({ status: 201, description: 'OTP challenge created' })
  @ApiResponse({ status: 400, description: 'VALIDATION_INVALID_PHONE' })
  @ApiResponse({ status: 429, description: 'AUTH_RATE_LIMITED or AUTH_RESEND_COOLDOWN' })
  async requestOtp(@Body() dto: RequestOtpDto, @Ip() ip: string) {
    return this.authService.requestOtp(dto.phone, ip);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify an OTP and receive access + refresh tokens' })
  @ApiResponse({ status: 200, description: 'Tokens issued' })
  @ApiResponse({ status: 401, description: 'AUTH_INVALID_CODE or AUTH_CODE_EXPIRED' })
  @ApiResponse({ status: 429, description: 'AUTH_RATE_LIMITED' })
  async verifyOtp(@Body() dto: VerifyOtpDto, @Ip() ip: string) {
    return this.authService.verifyOtp(dto.phone, dto.code, ip);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate an access token using a refresh token' })
  @ApiResponse({ status: 200, description: 'Tokens rotated' })
  @ApiResponse({ status: 401, description: 'AUTH_INVALID_TOKEN' })
  async refresh(@Body() dto: RefreshTokenDto, @Ip() ip: string) {
    return this.authService.refreshToken(dto.refreshToken, ip);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current session' })
  @ApiResponse({ status: 200, description: 'Session revoked' })
  @ApiResponse({ status: 401, description: 'AUTH_MISSING_TOKEN or AUTH_INVALID_TOKEN' })
  async logout(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    await this.authService.logout(user.sessionId, user.id, ip);
    return { loggedOut: true };
  }

  @Get('me')
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated user profile and roles' })
  @ApiResponse({ status: 200, description: 'Profile' })
  @ApiResponse({ status: 401, description: 'AUTH_MISSING_TOKEN or AUTH_INVALID_TOKEN' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getCurrentUser(user.id);
  }
}
