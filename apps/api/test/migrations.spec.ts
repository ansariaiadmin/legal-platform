import * as fs from 'fs';
import * as path from 'path';

describe('Database Migrations', () => {
  const migrationsDir = path.join(__dirname, '../src/database/migrations');

  it('should have migration files', () => {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
  });

  it('should have timestamp-ordered migration files', () => {
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.ts'))
      .filter(f => !f.startsWith('.')); // exclude hidden files

    expect(files.length).toBeGreaterThan(0);

    // Check that files start with numeric prefix (timestamp order)
    const numberedFiles = files.filter(f => /^\d{3}_/.test(f));
    expect(numberedFiles.length).toBe(files.length);

    // Verify ordering
    const numbers = numberedFiles.map(f => parseInt(f.split('_')[0], 10));
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBeGreaterThan(numbers[i - 1]);
    }
  });

  it('should have up and down functions in each migration', () => {
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.ts') && /^\d{3}_/.test(f));

    for (const file of files) {
      const content = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      
      // Check for exported up function
      expect(content).toMatch(/export\s+const\s+up\s*:/);
      
      // Check for exported down function
      expect(content).toMatch(/export\s+const\s+down\s*:/);
    }
  });

  it('migration 001 should create extensions', () => {
    const migration001 = path.join(migrationsDir, '001_extensions_and_helpers.ts');
    expect(fs.existsSync(migration001)).toBe(true);
    
    const content = fs.readFileSync(migration001, 'utf-8');
    expect(content).toContain('vector');
    expect(content).toContain('pgcrypto');
    expect(content).toContain('set_updated_at');
  });

  it('migration 002 should create identity tables', () => {
    const migration002 = path.join(migrationsDir, '002_identity_tables.ts');
    expect(fs.existsSync(migration002)).toBe(true);
    
    const content = fs.readFileSync(migration002, 'utf-8');
    expect(content).toContain('roles');
    expect(content).toContain('users');
    expect(content).toContain('role_assignments');
    expect(content).toContain('user_sessions');
    expect(content).toContain('otp_challenges');
    expect(content).toContain('lawyer_owner');
    expect(content).toContain('staff');
    expect(content).toContain('client');
    expect(content).toContain('operator');
  });

  it('migration 003 should create ops tables', () => {
    const migration003 = path.join(migrationsDir, '003_ops_tables.ts');
    expect(fs.existsSync(migration003)).toBe(true);
    
    const content = fs.readFileSync(migration003, 'utf-8');
    expect(content).toContain('audit_logs');
    expect(content).toContain('provider_configs');
    expect(content).toContain('backup_jobs');
    expect(content).toContain('restore_jobs');
    expect(content).toContain('diagnostic_runs');
    expect(content).toContain('system_notices');
    expect(content).toContain('license_records');
    expect(content).toContain('data_export_requests');
    expect(content).toContain('data_erasure_requests');
  });
});
