import { MigrationBuilder } from 'node-pg-migrate';

/**
 * Migration 003: Operations Tables
 * 
 * Creates ops-related tables per SPEC section 5:
 * - audit_logs (partition-ready by design)
 * - provider_configs
 * - backup_jobs
 * - restore_jobs
 * - diagnostic_runs
 * - system_notices
 * - license_records
 * - data_export_requests
 * - data_erasure_requests
 */

export const up = (pgm: MigrationBuilder) => {
  // Create audit_logs table (partition-ready design with composite PK)
  pgm.createTable('audit_logs', {
    id: { type: 'uuid', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: 'now()' },
    actor_id: { type: 'uuid' },
    actor_type: { type: 'text' },
    module: { type: 'text', notNull: true },
    action: { type: 'text', notNull: true },
    entity_type: { type: 'text' },
    entity_id: { type: 'text' },
    metadata: { type: 'jsonb', notNull: true, default: '{}' },
    ip: { type: 'inet' },
    result: { type: 'text', notNull: true },
  });

  // Add composite primary key via SQL (node-pg-migrate doesn't support composite PK in createTable options)
  pgm.createConstraint('audit_logs', 'audit_logs_pkey', {
    primaryKey: ['id', 'created_at']
  });

  // Indexes for audit_logs
  pgm.createIndex('audit_logs', ['module', 'action']);
  pgm.createIndex('audit_logs', 'actor_id');
  pgm.createIndex('audit_logs', 'created_at');

  // Create provider_configs table
  pgm.createTable('provider_configs', {
    id: { type: 'uuid', primaryKey: true },
    provider_type: { 
      type: 'text', 
      notNull: true,
      check: "provider_type IN ('sms','payment','ai','telephony','storage','push')"
    },
    adapter_key: { type: 'text', notNull: true },
    config: { type: 'jsonb', notNull: true, default: '{}' },
    encrypted_secrets: { type: 'text' },
    is_active: { type: 'boolean', notNull: true, default: false },
    health_status: { 
      type: 'text', 
      notNull: true, 
      default: 'unknown' 
    },
    last_health_check_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: 'now()' },
    updated_at: { type: 'timestamptz', notNull: true, default: 'now()' },
  });

  // Unique constraint on (provider_type, adapter_key)
  pgm.addConstraint('provider_configs', 'unique_provider_type_adapter', {
    unique: ['provider_type', 'adapter_key']
  });

  // Add set_updated_at trigger to provider_configs
  pgm.createTrigger('provider_configs', 'set_provider_configs_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    function: 'set_updated_at()',
    level: 'ROW',
  });

  // Create backup_jobs table
  pgm.createTable('backup_jobs', {
    id: { type: 'uuid', primaryKey: true },
    status: { 
      type: 'text', 
      notNull: true,
      check: "status IN ('queued','running','completed','failed','expired')"
    },
    trigger: { 
      type: 'text', 
      notNull: true,
      check: "trigger IN ('manual','scheduled')"
    },
    artifact_path: { type: 'text' },
    checksum: { type: 'text' },
    size_bytes: { type: 'bigint' },
    error: { type: 'text' },
    started_at: { type: 'timestamptz' },
    finished_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: 'now()' },
  });

  // Create restore_jobs table
  pgm.createTable('restore_jobs', {
    id: { type: 'uuid', primaryKey: true },
    status: { 
      type: 'text', 
      notNull: true,
      check: "status IN ('queued','running','completed','failed','expired')"
    },
    artifact_path: { type: 'text', notNull: true },
    checksum_verified: { type: 'boolean', notNull: true, default: false },
    confirmed_by: { type: 'text', notNull: true },
    error: { type: 'text' },
    started_at: { type: 'timestamptz' },
    finished_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: 'now()' },
  });

  // Create diagnostic_runs table
  pgm.createTable('diagnostic_runs', {
    id: { type: 'uuid', primaryKey: true },
    status: { type: 'text', notNull: true },
    results: { type: 'jsonb', notNull: true, default: '{}' },
    started_at: { type: 'timestamptz' },
    finished_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: 'now()' },
  });

  // Create system_notices table
  pgm.createTable('system_notices', {
    id: { type: 'uuid', primaryKey: true },
    key: { type: 'text', unique: true, notNull: true },
    severity: { 
      type: 'text', 
      notNull: true,
      check: "severity IN ('info','warning','critical')"
    },
    message_fa: { type: 'text', notNull: true },
    message_en: { type: 'text', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: 'now()' },
  });

  // Create license_records table
  pgm.createTable('license_records', {
    id: { type: 'uuid', primaryKey: true },
    license_key: { type: 'text', unique: true, notNull: true },
    tier: { type: 'text', notNull: true },
    issued_at: { type: 'timestamptz' },
    expires_at: { type: 'timestamptz' },
    metadata: { type: 'jsonb', notNull: true, default: '{}' },
  });

  // Create data_export_requests table
  pgm.createTable('data_export_requests', {
    id: { type: 'uuid', primaryKey: true },
    requester_id: { 
      type: 'uuid', 
      references: 'users',
      onDelete: 'SET NULL'
    },
    subject_type: { type: 'text' },
    subject_id: { type: 'uuid' },
    status: { type: 'text', notNull: true, default: 'pending' },
    cooldown_until: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: 'now()' },
  });

  // Create data_erasure_requests table (same shape as data_export_requests)
  pgm.createTable('data_erasure_requests', {
    id: { type: 'uuid', primaryKey: true },
    requester_id: { 
      type: 'uuid', 
      references: 'users',
      onDelete: 'SET NULL'
    },
    subject_type: { type: 'text' },
    subject_id: { type: 'uuid' },
    status: { type: 'text', notNull: true, default: 'pending' },
    cooldown_until: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: 'now()' },
  });
};

export const down = (pgm: MigrationBuilder) => {
  // Drop tables in reverse order of creation
  pgm.dropTable('data_erasure_requests');
  pgm.dropTable('data_export_requests');
  pgm.dropTable('license_records');
  pgm.dropTable('system_notices');
  pgm.dropTable('diagnostic_runs');
  pgm.dropTable('restore_jobs');
  pgm.dropTable('backup_jobs');
  pgm.dropTable('provider_configs');
  pgm.dropTable('audit_logs');
};
