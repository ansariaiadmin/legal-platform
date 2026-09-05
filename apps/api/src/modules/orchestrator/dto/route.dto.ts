import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
}
