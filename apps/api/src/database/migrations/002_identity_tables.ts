import type { MigrationBuilder } from 'node-pg-migrate' with { 'resolution-mode': 'import' };

/**
 * Migration 002: Identity Tables
 *
 * Creates core identity-related tables per SPEC sections 5 and 6:
 * - roles (seeded with lawyer_owner, staff, client, operator)
 * - users
 * - role_assignments
 * - user_sessions
 * - otp_challenges
 *
 * DEFAULT clauses holding raw SQL expressions are applied with plain SQL
 * below. A bare string in createTable() options is emitted as a quoted
 * literal, so `default: 'gen_random_uuid()'` produced
 * `DEFAULT 'gen_random_uuid()'` and PostgreSQL failed with
 * `invalid input syntax for type uuid`. node-pg-migrate's PgLiteral would
 * fix that, but it is a value import from an ESM-only package, which
 * Node16 module resolution rejects.
 * string is emitted as a quoted literal, so `default: 'gen_random_uuid()'`
 * produced `DEFAULT 'gen_random_uuid()'` and PostgreSQL failed with
 * `invalid input syntax for type uuid`.
 */

export const up = (pgm: MigrationBuilder) => {
  // Create roles table
  pgm.createTable('roles', {
    id: { type: 'uuid', primaryKey: true },
    key: { type: 'text', notNull: true, unique: true },
    description: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true },
  });

  // The seed below relies on created_at having a default, so it is applied here
  // rather than with the rest of the tables at the end of up().
  pgm.sql(`
    ALTER TABLE roles ALTER COLUMN id         SET DEFAULT gen_random_uuid();
    ALTER TABLE roles ALTER COLUMN created_at SET DEFAULT now();
  `);

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
    id: { type: 'uuid', primaryKey: true },
    phone_normalized: { type: 'text', unique: true },
    email: { type: 'text', unique: true },
    display_name: { type: 'text' },
    password_hash: { type: 'text' },
    status: {
      type: 'text',
      notNull: true,
      default: 'active',
      check: "status IN ('active', 'disabled')",
    },
    created_at: { type: 'timestamptz', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true },
  });

  pgm.addConstraint('users', 'users_phone_or_email_check', {
    check: 'phone_normalized IS NOT NULL OR email IS NOT NULL',
  });

  pgm.createTrigger('users', 'set_users_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    function: 'set_updated_at',
    level: 'ROW',
  });

  // Create role_assignments table
  pgm.createTable('role_assignments', {
    id: { type: 'uuid', primaryKey: true },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    role_id: {
      type: 'uuid',
      notNull: true,
      references: 'roles',
    },
    assigned_by: {
      type: 'uuid',
      references: 'users',
      onDelete: 'SET NULL',
    },
    created_at: { type: 'timestamptz', notNull: true },
  });

  pgm.addConstraint('role_assignments', 'unique_user_role', {
    unique: ['user_id', 'role_id'],
  });

  // Create user_sessions table
  pgm.createTable('user_sessions', {
    id: { type: 'uuid', primaryKey: true },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    access_token_hash: { type: 'text', notNull: true },
    refresh_token_hash: { type: 'text', notNull: true },
    device: { type: 'jsonb' },
    ip: { type: 'inet' },
    user_agent: { type: 'text' },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true },
  });

  pgm.createIndex('user_sessions', 'user_id');
  pgm.createIndex('user_sessions', 'expires_at');

  // Create otp_challenges table
  pgm.createTable('otp_challenges', {
    id: { type: 'uuid', primaryKey: true },
    destination: { type: 'text', notNull: true },
    code_hash: { type: 'text', notNull: true },
    purpose: {
      type: 'text',
      notNull: true,
      default: 'login',
    },
    attempts: { type: 'int', notNull: true, default: 0 },
    max_attempts: { type: 'int', notNull: true, default: 5 },
    expires_at: { type: 'timestamptz', notNull: true },
    verified_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true },
  });

  // Partial index on destination where verified_at is null (for active challenges)
  pgm.createIndex('otp_challenges', 'destination', {
    where: 'verified_at IS NULL',
  });
  // Apply the raw-SQL defaults. See the note at the top of this file: a bare
  // string in createTable() options becomes a quoted literal, not an expression.
  pgm.sql(`
    ALTER TABLE users            ALTER COLUMN id         SET DEFAULT gen_random_uuid();
    ALTER TABLE users            ALTER COLUMN created_at SET DEFAULT now();
    ALTER TABLE users            ALTER COLUMN updated_at SET DEFAULT now();
    ALTER TABLE role_assignments ALTER COLUMN id         SET DEFAULT gen_random_uuid();
    ALTER TABLE role_assignments ALTER COLUMN created_at SET DEFAULT now();
    ALTER TABLE user_sessions    ALTER COLUMN id         SET DEFAULT gen_random_uuid();
    ALTER TABLE user_sessions    ALTER COLUMN created_at SET DEFAULT now();
    ALTER TABLE otp_challenges   ALTER COLUMN id         SET DEFAULT gen_random_uuid();
    ALTER TABLE otp_challenges   ALTER COLUMN created_at SET DEFAULT now();
  `);
};

export const down = (pgm: MigrationBuilder) => {
  pgm.sql(`
    ALTER TABLE otp_challenges   ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE otp_challenges   ALTER COLUMN id         DROP DEFAULT;
    ALTER TABLE user_sessions    ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE user_sessions    ALTER COLUMN id         DROP DEFAULT;
    ALTER TABLE role_assignments ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE role_assignments ALTER COLUMN id         DROP DEFAULT;
    ALTER TABLE users            ALTER COLUMN updated_at DROP DEFAULT;
    ALTER TABLE users            ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE users            ALTER COLUMN id         DROP DEFAULT;
    ALTER TABLE roles            ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE roles            ALTER COLUMN id         DROP DEFAULT;
  `);
  pgm.dropTable('otp_challenges');
  pgm.dropTable('user_sessions');
  pgm.dropTable('role_assignments');
  pgm.dropTable('users');
  pgm.dropTable('roles');
};
