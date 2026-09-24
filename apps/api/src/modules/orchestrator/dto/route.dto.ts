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
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
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

export class AssignModelDto {
  @ApiProperty({ enum: ['local', 'cloud'] })
  @IsIn(['local', 'cloud'])
  target!: 'local' | 'cloud';

  @ApiProperty({ example: 'qwen2.5:14b-instruct', description: 'concrete model id' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  model!: string;
}

// ---------- leader conversation (ADR-013) ----------

export class LeaderChatDto {
  @ApiPropertyOptional({ description: 'existing conversation id; omit to open a new one' })
  @IsUUID()
  @IsOptional()
  conversationId?: string;

  @ApiProperty({ example: 'این سند اجاره فروشگاه رو بررسی کن' })
  @IsString()
  @MaxLength(4000)
  text!: string;

  @ApiPropertyOptional({ type: [String], description: 'fileIds previously uploaded' })
  @IsString({ each: true })
  @IsOptional()
  fileIds?: string[];

  @ApiPropertyOptional({ enum: ['privileged', 'normal'] })
  @IsIn(['privileged', 'normal'])
  @IsOptional()
  sensitivity?: 'privileged' | 'normal';
}

export class LeaderVoiceChatDto {
  @ApiProperty()
  @IsUUID()
  sessionId!: string;

  @ApiProperty()
  @IsUUID()
  conversationId!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  transcriptHint?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsString({ each: true })
  @IsOptional()
  fileIds?: string[];
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

// ---------- evolution (ADR-009) ----------

export class SpawnSkillDto {
  @ApiProperty({ example: 'tax:audit-review' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  id!: string;

  @ApiProperty({ example: 'بررسی اظهارنامه و صورتحساب مالیاتی' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  description!: string;

  @ApiProperty({ example: ['اظهارنامه', 'مالیات بر ارزش افزوده', 'بخشنامه مالیاتی'], type: [String] })
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(60, { each: true })
  terms!: string[];
}

export class SpawnAgentDto {
  @ApiProperty({ example: 'tax-expert' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  agentId!: string;

  @ApiProperty({ example: 'commercial', description: 'a member of LegalField' })
  @IsString()
  @IsNotEmpty()
  field!: string;

  @ApiProperty({ example: 'کارشناس ارشد امور مالیاتی' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  displayName!: string;

  @ApiProperty({ example: 'در مالیات، سند گمشده یعنی مالیات بر دوباره‌خوانی.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  motto!: string;

  @ApiProperty({ type: [SpawnSkillDto] })
  @ValidateNested({ each: true })
  @Type(() => SpawnSkillDto)
  skills!: SpawnSkillDto[];
}
