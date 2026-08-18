import { EnvService } from '../src/config/env';

describe('EnvService', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://test';
    process.env.JWT_ACCESS_SECRET = 'test-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh';
    process.env.ENCRYPTION_MASTER_KEY = 'test-key';
  });

  it('should initialize without throwing in development mode', () => {
    expect(() => new EnvService()).not.toThrow();
  });

  it('should return correct nodeEnv', () => {
    const service = new EnvService();
    expect(service.nodeEnv).toBe('development');
  });

  it('should throw in production when secrets are missing', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = '';
    
    expect(() => new EnvService()).toThrow('Missing required environment variable: DATABASE_URL');
  });
});
