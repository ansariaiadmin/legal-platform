import { ConfigService } from '@nestjs/config';
import {
  StorageProvider,
  StorageObject,
  StorageListResult,
  StorageProviderMetadata,
} from './storage.provider';
import { ProviderError, PROVIDER_ERROR_CODES } from '../provider.error';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export class LocalStorageAdapter implements StorageProvider {
  private readonly basePath: string;

  constructor(private configService: ConfigService) {
    this.basePath = this.configService.get<string>('LOCAL_STORAGE_PATH') ?? './uploads';
    
    // Ensure base path exists
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  async put(input: {
    key: string;
    content: Buffer | string;
    contentType?: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string; key: string }> {
    const fullPath = join(this.basePath, input.key);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const content = typeof input.content === 'string' ? Buffer.from(input.content) : input.content;
    writeFileSync(fullPath, content);

    return {
      url: `/uploads/${input.key}`,
      key: input.key,
    };
  }

  async get(key: string): Promise<Buffer> {
    const fullPath = join(this.basePath, key);
    
    if (!existsSync(fullPath)) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.NOT_FOUND,
        `File not found: ${key}`,
      );
    }

    return readFileSync(fullPath);
  }

  async delete(key: string): Promise<void> {
    const fullPath = join(this.basePath, key);
    
    if (existsSync(fullPath)) {
      unlinkSync(fullPath);
    }
  }

  async list(input: { prefix?: string; cursor?: string; limit?: number }): Promise<StorageListResult> {
    const prefix = input.prefix ?? '';
    const limit = input.limit ?? 100;
    
    const searchPath = prefix ? join(this.basePath, prefix) : this.basePath;
    
    if (!existsSync(searchPath)) {
      return { objects: [], hasMore: false };
    }

    const objects: StorageObject[] = [];
    const entries = readdirSync(searchPath, { withFileTypes: true });

    for (const entry of entries.slice(0, limit)) {
      const fullPath = join(searchPath, entry.name);
      const stats = statSync(fullPath);
      
      if (stats.isFile()) {
        const relativeKey = fullPath.replace(this.basePath + '/', '');
        objects.push({
          key: relativeKey,
          size: stats.size,
          lastModified: stats.mtime,
        });
      }
    }

    return {
      objects,
      hasMore: entries.length > limit,
    };
  }

  async verifyConfig(): Promise<{ valid: boolean; error?: string }> {
    try {
      // Self-test: write and read back a test file
      const testKey = '.health_check_test';
      const testContent = 'test';
      const fullPath = join(this.basePath, testKey);

      writeFileSync(fullPath, testContent);
      const readBack = readFileSync(fullPath, 'utf-8');
      unlinkSync(fullPath);

      if (readBack !== testContent) {
        return {
          valid: false,
          error: 'Storage self-test failed: content mismatch',
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Storage self-test failed: ${(error as Error).message}`,
      };
    }
  }

  getMetadata(): StorageProviderMetadata {
    return {
      name: 'Local Storage Adapter',
      driverType: 'local',
      supportedContentTypes: ['*/*'],
    };
  }
}
