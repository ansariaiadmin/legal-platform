import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PROVIDER_CATEGORIES, type ProviderCategory } from '../../../providers/provider.tokens';

export class CreateProviderConfigDto {
  @ApiProperty({ enum: PROVIDER_CATEGORIES })
  @IsIn(PROVIDER_CATEGORIES)
  providerType!: ProviderCategory;

  @ApiProperty({ example: 'mock' })
  @IsString()
  @IsNotEmpty()
  adapterKey!: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  /**
   * Plaintext on the wire (TLS), encrypted at rest. Never returned by any
   * response - the API only reports whether secrets exist.
   */
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  secrets?: Record<string, string>;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateProviderConfigDto {
  @ApiPropertyOptional({ example: 'mock' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  adapterKey?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  secrets?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetFallbackDto {
  /** `null` clears the fallback. */
  @ApiPropertyOptional({ nullable: true, type: String })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  fallbackId!: string | null;
}
