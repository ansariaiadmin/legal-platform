import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

export interface AuditLogEntry {
  actorId?: string;
  actorType?: 'user' | 'system' | 'provider';
  module: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  result: 'success' | 'failure' | 'error';
}

/**
 * Append-only audit trail (SPEC section 5 and 10).
 *
 * `audit_logs.id` has no server-side default in migration 003, so the id is
 * generated here - without it every insert failed a NOT NULL constraint and,
 * because the error was swallowed below, the audit trail silently stayed empty.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly pool: Pool) {}

  async log(entry: AuditLogEntry): Promise<void> {
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
        `INSERT INTO audit_logs
           (id, actor_id, actor_type, module, action, entity_type, entity_id, metadata, ip, result)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          randomUUID(),
          actorId ?? null,
          actorType,
          moduleName,
          action,
          entityType ?? null,
          entityId ?? null,
          JSON.stringify(metadata),
          ip ?? null,
          result,
        ],
      );
      this.logger.debug(`Audit log recorded: ${moduleName}.${action}`);
    } catch (err) {
      const error = err as Error;
      // Never break the caller's operation, but make the loss loud.
      this.logger.error(
        `Failed to record audit log ${moduleName}.${action}: ${error.message}`,
      );
    }
  }
}
