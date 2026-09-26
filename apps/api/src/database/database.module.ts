import { Module, Global } from '@nestjs/common';
import { Pool } from 'pg';

const poolProvider = {
  provide: Pool,
  useFactory: () => {
    // TLS is opt-in: the bundled PostgreSQL container speaks plain TCP on the
    // private Docker network. For a managed database either add
    // `?sslmode=require` to DATABASE_URL or set DATABASE_SSL=true.
    const ssl =
      process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
        : undefined;
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl,
      max: Number(process.env.DATABASE_POOL_MAX) || 10,
    });

    pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });

    return pool;
  },
};

@Global()
@Module({
  providers: [poolProvider],
  exports: [poolProvider],
})
export class DatabaseModule {}
