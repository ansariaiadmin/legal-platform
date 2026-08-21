import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';

export interface AuditLogEntry {
  actorId?: string;
  actorType?: string;
  module: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  result: 'success' | 'failure' | 'error';
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly pool: Pool) {}

  async log(entry: AuditLogEntry & { actorId?: string }): Promise<void> {
    const {
      actorId,
      actorType = 'user',
      module: moduleName,
      action,
      entityType,
      entityId,
      metadata = {},
      ip,
      result,
    } = entry;

    try {
      await this.pool.query(
        `INSERT INTO audit_logs (actor_id, actor_type, module, action, entity_type, entity_id, metadata, ip, result)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          actorId || null,
          actorType,
          moduleName,
          action,
          entityType || null,
          entityId || null,
          JSON.stringify(metadata),
          ip || null,
          result,
        ],
      );
      this.logger.debug(`Audit log recorded: ${moduleName}.${action}`);
    } catch (err) {
      const error = err as Error;
      this.logger.error(`Failed to record audit log: ${error.message}`);
      // Don't throw - audit logging failure shouldn't break the main operation
    }
  }
}
