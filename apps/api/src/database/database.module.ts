import { Module, Global } from '@nestjs/common';
import { Pool } from 'pg';

const poolProvider = {
  provide: Pool,
  useFactory: () => {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
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
