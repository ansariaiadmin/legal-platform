import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * P11: field testers who open the bare API host must meet a name, not a
 * 404 wall. One small honest billboard: who we are, where docs + health live.
 */
@ApiTags('root')
@Controller()
export class RootController {
  @Get()
  @ApiOperation({ summary: 'Service billboard (no 404 on the bare host)' })
  root(): { service: string; links: Record<string, string> } {
    return {
      service: 'پلتفرم حقوقی — Legal Platform API',
      links: { docs: '/api/docs', health: '/api/health' },
    };
  }
}
