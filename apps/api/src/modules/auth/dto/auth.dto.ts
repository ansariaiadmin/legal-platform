import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';
import { toLatinDigits } from '@legal-platform/shared';

/** Persian/Arabic-Indic digits → ASCII, surrounding spaces trimmed. */
const LatinDigits = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? toLatinDigits(value).trim() : value));

export class RequestOtpDto {
  @LatinDigits()
  @IsNotEmpty()
  @IsString()
  @Matches(/^[0-9+\-\s()]+$/, {
    message: 'Invalid phone number format',
  })
  phone!: string;
}

export class VerifyOtpDto {
  @LatinDigits()
  @IsNotEmpty()
  @IsString()
  phone!: string;

  @LatinDigits()
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
  @IsNotEmpty()
  @IsString()
  @IsEmail({}, { message: 'Invalid email address format' })
  email!: string;
}

export class VerifyEmailOtpDto {
  @IsNotEmpty()
  @IsString()
  @IsEmail({}, { message: 'Invalid email address format' })
  email!: string;

  @LatinDigits()
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code!: string;
}
