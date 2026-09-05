import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { GovernanceCapability } from '@legal-platform/shared';

export class RouteQueryDto {
  @ApiProperty({ example: 'شرایط فسخ قرارداد اجاره چیست؟' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  query!: string;

  @ApiPropertyOptional({ description: 'optional client-provided correlation id' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  taskId?: string;

  @ApiPropertyOptional({
    enum: ['privileged', 'normal'],
    description: 'privileged => never leaves the box (ADR-004)',
  })
  @IsIn(['privileged', 'normal'])
  @IsOptional()
  sensitivity?: 'privileged' | 'normal';
}

export class GrantAgentDto {
  @ApiProperty({ example: 'legal-expert-base' })
  @IsString()
  @IsNotEmpty()
  agentId!: string;

  @ApiProperty({ example: 'expert:civil:execute' })
  @IsString()
  @IsNotEmpty()
  capability!: GovernanceCapability;

  @ApiProperty({ example: 60, description: 'grant lifetime in minutes (1..10080)' })
  @IsInt()
  @Min(1)
  @Max(10080)
  ttlMinutes!: number;
}

export class VoiceTurnDto {
  @ApiProperty({ description: 'session id returned by POST /voice/session' })
  @IsUUID()
  sessionId!: string;

  @ApiPropertyOptional({
    description: 'mock-engine transcript hint (real engines ignore it)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  transcriptHint?: string;
}
