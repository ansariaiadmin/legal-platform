import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class RequestOtpDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^[0-9+\-\s()]+$/, {
    message: 'Invalid phone number format',
  })
  phone!: string;
}

export class VerifyOtpDto {
  @IsNotEmpty()
  @IsString()
  phone!: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'Code must be 6 digits',
  })
  code!: string;
}

export class RefreshTokenDto {
  @IsNotEmpty()
  @IsString()
  refreshToken!: string;
}

/** P10: email channel (owed since P8) — same discipline as phone OTP. */
export class RequestEmailOtpDto {
  email!: string;
}

export class VerifyEmailOtpDto {
  email!: string;
  code!: string;
}
