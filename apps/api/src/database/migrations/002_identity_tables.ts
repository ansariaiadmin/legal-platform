import { MigrationBuilder } from 'node-pg-migrate';

/**
 * Migration 002: Identity Tables
 * 
 * Creates core identity-related tables per SPEC sections 5 and 6:
 * - roles (seeded with lawyer_owner, staff, client, operator)
 * - users
 * - role_assignments
 * - user_sessions
 * - otp_challenges
 */

export const up = (pgm: MigrationBuilder) => {
  // Create roles table
  pgm.createTable('roles', {
    id: { type: 'uuid', primaryKey: true },
    key: { type: 'text', notNull: true, unique: true },
    description: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: 'now()' },
  });

  // Seed roles with required values
  pgm.sql(`
    INSERT INTO roles (id, key, description) VALUES
    (gen_random_uuid(), 'lawyer_owner', 'Primary lawyer/owner of the practice'),
    (gen_random_uuid(), 'staff', 'Staff member with limited permissions'),
    (gen_random_uuid(), 'client', 'Client/customer role'),
    (gen_random_uuid(), 'operator', 'Setup-only operator role')
  `);

  // Create users table
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: 'gen_random_uuid()' },
    phone_normalized: { type: 'text', unique: true },
    email: { type: 'text', unique: true },
    display_name: { type: 'text' },
    password_hash: { type: 'text' },
    status: { 
      type: 'text', 
      notNull: true, 
      default: 'active',
      check: "status IN ('active', 'disabled')"
    },
    created_at: { type: 'timestamptz', notNull: true, default: 'now()' },
    updated_at: { type: 'timestamptz', notNull: true, default: 'now()' },
  });

  // Add check constraint for users table
  pgm.addConstraint('users', 'users_phone_or_email_check', {
    check: 'phone_normalized IS NOT NULL OR email IS NOT NULL'
  });

  // Add set_updated_at trigger to users
  pgm.createTrigger('users', 'set_users_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    function: 'set_updated_at()',
    level: 'ROW',
  });

  // Create role_assignments table
  pgm.createTable('role_assignments', {
    id: { type: 'uuid', primaryKey: true },
    user_id: { 
      type: 'uuid', 
      notNull: true, 
      references: 'users', 
      onDelete: 'CASCADE' 
    },
    role_id: { 
      type: 'uuid', 
      notNull: true, 
      references: 'roles' 
    },
    assigned_by: { 
      type: 'uuid', 
      references: 'users',
      onDelete: 'SET NULL'
    },
    created_at: { type: 'timestamptz', notNull: true, default: 'now()' },
  });

  // Unique constraint on (user_id, role_id)
  pgm.addConstraint('role_assignments', 'unique_user_role', {
    unique: ['user_id', 'role_id']
  });

  // Create user_sessions table
  pgm.createTable('user_sessions', {
    id: { type: 'uuid', primaryKey: true },
    user_id: { 
      type: 'uuid', 
      notNull: true, 
      references: 'users', 
      onDelete: 'CASCADE' 
    },
    access_token_hash: { type: 'text', notNull: true },
    refresh_token_hash: { type: 'text', notNull: true },
    device: { type: 'jsonb' },
    ip: { type: 'inet' },
    user_agent: { type: 'text' },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: 'now()' },
  });

  // Index on user_id for session lookups
  pgm.createIndex('user_sessions', 'user_id');
  // Index on expires_at for cleanup queries
  pgm.createIndex('user_sessions', 'expires_at');

  // Create otp_challenges table
  pgm.createTable('otp_challenges', {
    id: { type: 'uuid', primaryKey: true },
    destination: { type: 'text', notNull: true },
    code_hash: { type: 'text', notNull: true },
    purpose: { 
      type: 'text', 
      notNull: true, 
      default: 'login' 
    },
    attempts: { type: 'int', notNull: true, default: 0 },
    max_attempts: { type: 'int', notNull: true, default: 5 },
    expires_at: { type: 'timestamptz', notNull: true },
    verified_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: 'now()' },
  });

  // Partial index on destination where verified_at is null (for active challenges)
  pgm.createIndex('otp_challenges', 'destination', {
    where: 'verified_at IS NULL'
  });
};

export const down = (pgm: MigrationBuilder) => {
  // Drop tables in reverse order of creation
  pgm.dropTable('otp_challenges');
  pgm.dropTable('user_sessions');
  pgm.dropTable('role_assignments');
  pgm.dropTable('users');
  pgm.dropTable('roles');
};
