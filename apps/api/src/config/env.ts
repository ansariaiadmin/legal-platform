import { Injectable, Logger } from '@nestjs/common';

interface EnvConfig {
  NODE_ENV: string;
  APP_URL: string;
  API_URL: string;
  CORS_ORIGINS: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  ENCRYPTION_MASTER_KEY: string;
  STORAGE_DRIVER: string;
  LOCAL_STORAGE_PATH: string;
  AI_ROUTING_MODE: string;
  AI_EMBEDDING_DIMENSION: number;
  LOG_LEVEL: string;
  /** P6-S1 hardening knobs — 'off' disables, anything else enables. */
  SECURITY_HEADERS: string;
  GLOBAL_RATE_LIMIT_PER_MIN: string;
  /** Python worker hard-requirement probe cadence (ms); 0 disables. */
  WORKER_PROBE_INTERVAL_MS: number;
  /** P9/P10: deployment + multi-node + email-factor knobs. */
  DEPLOYMENT_MODE: string;
  RATE_LIMIT_DRIVER: string;
  TENANT_SLUG: string;
  EMAIL_DRIVER: string;
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_FROM: string;
}

/**
 * Placeholder values shipped in `.env.example`. They must never survive into a
 * production process (SPEC section 10: "no default JWT secrets").
 */
const PLACEHOLDER_VALUES = new Set([
  '',
  'your_jwt_access_secret_here',
  'your_jwt_refresh_secret_here',
  'your_encryption_master_key_here',
  'change_me',
  'dev-secret',
]);

const SECRET_KEYS = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_MASTER_KEY'] as const;

@Injectable()
export class EnvService {
  private readonly logger = new Logger(EnvService.name);
  private readonly config: EnvConfig;

  constructor() {
    this.config = {
      NODE_ENV: process.env.NODE_ENV || 'development',
      APP_URL: process.env.APP_URL || '',
      API_URL: process.env.API_URL || '',
      CORS_ORIGINS: process.env.CORS_ORIGINS || '',
      DATABASE_URL: process.env.DATABASE_URL || '',
      REDIS_URL: process.env.REDIS_URL || '',
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || '',
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || '',
      ENCRYPTION_MASTER_KEY: process.env.ENCRYPTION_MASTER_KEY || '',
      STORAGE_DRIVER: process.env.STORAGE_DRIVER || 'local',
      LOCAL_STORAGE_PATH: process.env.LOCAL_STORAGE_PATH || '/app/uploads',
      AI_ROUTING_MODE: process.env.AI_ROUTING_MODE || 'iranian_gateway',
      AI_EMBEDDING_DIMENSION: Number(process.env.AI_EMBEDDING_DIMENSION) || 1024,
      LOG_LEVEL: process.env.LOG_LEVEL || 'info',
      SECURITY_HEADERS: process.env.SECURITY_HEADERS || 'on',
      GLOBAL_RATE_LIMIT_PER_MIN: process.env.GLOBAL_RATE_LIMIT_PER_MIN || '',
      DEPLOYMENT_MODE: process.env.DEPLOYMENT_MODE || 'single',
      RATE_LIMIT_DRIVER: process.env.RATE_LIMIT_DRIVER || '',
      TENANT_SLUG: process.env.TENANT_SLUG || '',
      EMAIL_DRIVER: process.env.EMAIL_DRIVER || 'mock',
      SMTP_HOST: process.env.SMTP_HOST || '',
      SMTP_PORT: process.env.SMTP_PORT || '',
      SMTP_FROM: process.env.SMTP_FROM || '',
      WORKER_PROBE_INTERVAL_MS: Number(process.env.WORKER_PROBE_INTERVAL_MS) || 60_000,
    };

    this.validate();
  }

  private validate(): void {
    for (const key of SECRET_KEYS) {
      const value = this.config[key];

      if (PLACEHOLDER_VALUES.has(value)) {
        if (this.isProduction) {
          throw new Error(`Missing required environment variable: ${key}`);
        }
        this.logger.warn(`${key} is not set - falling back to development defaults`);
      }
    }

    if (this.config.JWT_ACCESS_SECRET === this.config.JWT_REFRESH_SECRET && this.config.JWT_ACCESS_SECRET) {
      if (this.isProduction) {
        throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
      }
      this.logger.warn('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are identical');
    }
  }

  get<K extends keyof EnvConfig>(key: K): EnvConfig[K] {
    return this.config[key];
  }

  get nodeEnv(): string {
    return this.config.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.config.NODE_ENV === 'production';
  }
}
