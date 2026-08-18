import { Injectable } from '@nestjs/common';

interface EnvConfig {
  NODE_ENV: string;
  APP_URL: string;
  API_URL: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  ENCRYPTION_MASTER_KEY: string;
}

@Injectable()
export class EnvService {
  private readonly config: EnvConfig;

  constructor() {
    this.config = {
      NODE_ENV: process.env.NODE_ENV || 'development',
      APP_URL: process.env.APP_URL || '',
      API_URL: process.env.API_URL || '',
      DATABASE_URL: process.env.DATABASE_URL || '',
      REDIS_URL: process.env.REDIS_URL || '',
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || '',
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || '',
      ENCRYPTION_MASTER_KEY: process.env.ENCRYPTION_MASTER_KEY || '',
    };

    this.validate();
  }

  private validate(): void {
    const isProduction = this.config.NODE_ENV === 'production';
    
    const requiredSecrets: (keyof EnvConfig)[] = [
      'DATABASE_URL',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'ENCRYPTION_MASTER_KEY',
    ];

    for (const secret of requiredSecrets) {
      if (!this.config[secret]) {
        if (isProduction) {
          throw new Error(`Missing required environment variable: ${secret}`);
        }
        console.warn(`Warning: ${secret} is not set`);
      }
    }
  }

  get(key: keyof EnvConfig): string {
    return this.config[key];
  }

  get nodeEnv(): string {
    return this.config.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.config.NODE_ENV === 'production';
  }
}
