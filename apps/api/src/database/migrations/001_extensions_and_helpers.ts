// node-pg-migrate v9 is ESM-only and its top-level `types` entry is missing,
// so the type-only import needs an explicit resolution mode under Node16.
import type { MigrationBuilder } from 'node-pg-migrate' with { 'resolution-mode': 'import' };

/**
 * Migration 001: Extensions and Helper Functions
 * 
 * Creates required PostgreSQL extensions and the set_updated_at() trigger function.
 * This migration must run first as other migrations depend on these extensions.
 */

export const up = (pgm: MigrationBuilder) => {
  // Create vector extension for pgvector (AI embeddings)
  pgm.sql('CREATE EXTENSION IF NOT EXISTS vector;');
  
  // Create pgcrypto extension for UUID generation and crypto functions
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  
  // Create set_updated_at() trigger function
  // This function updates the updated_at column on row update
  pgm.createFunction(
    'set_updated_at()',
    [],
    {
      returns: 'trigger',
      language: 'plpgsql',
    },
    `
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    `
  );
};

export const down = (pgm: MigrationBuilder) => {
  // Drop the trigger function
  pgm.dropFunction('set_updated_at()', []);
  
  // Drop extensions (IF EXISTS to avoid errors if already dropped)
  pgm.sql('DROP EXTENSION IF EXISTS vector;');
  pgm.sql('DROP EXTENSION IF EXISTS pgcrypto;');
};
