import { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder) => {
  // Add fallback_provider_config_id column to provider_configs
  pgm.sql(`
    ALTER TABLE provider_configs 
    ADD COLUMN fallback_provider_config_id uuid NULL,
    ADD CONSTRAINT fk_provider_configs_fallback 
      FOREIGN KEY (fallback_provider_config_id) 
      REFERENCES provider_configs(id) 
      ON DELETE SET NULL
  `);
};

export const down = (pgm: MigrationBuilder) => {
  // Remove the foreign key constraint and column
  pgm.sql(`
    ALTER TABLE provider_configs 
    DROP CONSTRAINT IF EXISTS fk_provider_configs_fallback,
    DROP COLUMN IF EXISTS fallback_provider_config_id
  `);
};
