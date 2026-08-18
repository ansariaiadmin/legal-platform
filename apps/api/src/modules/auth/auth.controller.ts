import {
  Controller,
  Post,
  Get,
  Body,
  Ip,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RequestOtpDto, VerifyOtpDto, RefreshTokenDto } from './dto/auth.dto';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { CurrentUser } from '../../security/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('otp/request')
  @ApiOperation({ summary: 'Request OTP for login' })
  @ApiResponse({ status: 201, description: 'OTP sent successfully' })
  @ApiResponse({ status: 400, description: 'Invalid phone number' })
  @ApiResponse({ status: 403, description: 'Rate limited' })
  async requestOtp(@Body() dto: RequestOtpDto, @Ip() ip: string) {
    return this.authService.requestOtp(dto.phone, ip);
  }

  @Post('otp/verify')
  @ApiOperation({ summary: 'Verify OTP and get tokens' })
  @ApiResponse({ status: 200, description: 'Verification successful' })
  @ApiResponse({ status: 400, description: 'Invalid code' })
  @ApiResponse({ status: 403, description: 'Code expired or rate limited' })
  async verifyOtp(@Body() dto: VerifyOtpDto, @Ip() ip: string) {
    return this.authService.verifyOtp(dto.phone, dto.code, ip);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Tokens refreshed' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refresh(@Body() dto: RefreshTokenDto, @Ip() ip: string) {
    return this.authService.refreshToken(dto.refreshToken, ip);
  }

  @Post('logout')
  @UseGuards(JwtAccessGuard)
  @ApiOperation({ summary: 'Logout and revoke session' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(
    @CurrentUser() user: { id: string; sessionId: string },
    @Ip() ip: string,
  ) {
    await this.authService.logout(user.sessionId, user.id, ip);
    return { success: true };
  }

  @Get('me')
  @UseGuards(JwtAccessGuard)
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async me(@CurrentUser() user: { id: string }) {
    return this.authService.getCurrentUser(user.id);
  }
}
