import { ConfigService } from '@nestjs/config';
import {
  StorageProvider,
  StorageObject,
  StorageListResult,
  StorageProviderMetadata,
} from './storage.provider';
import { ProviderError, PROVIDER_ERROR_CODES } from '../provider.error';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

export class LocalStorageAdapter implements StorageProvider {
  private readonly basePath: string;

  constructor(private configService: ConfigService) {
    // ABSOLUTE-anchored, always: join() normalizes './uploads/x' → 'uploads/x'
    // while '' + basePath arithmetic would corrupt derived keys ('ntime/…'
    // after slicing the './' off by hand). resolve() once, then relative().
    this.basePath = resolve(this.configService.get<string>('LOCAL_STORAGE_PATH') ?? './uploads');
    
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
    
    // Nested keys (runtime/security/reports.json) are FIRST-CLASS citizens
    // of this provider — a non-recursive list would silently omit them, and
    // the silent omission broke backup fidelity in the wild (P7). Walk the
    // tree; `prefix` filters by KEY prefix (not directory path) so dotted
    // prefixes like 'runtime/' behave like an object store, not a shell.
    if (!existsSync(this.basePath)) {
      return { objects: [], hasMore: false };
    }

    const objects: StorageObject[] = [];
    const stack: string[] = [this.basePath];
    while (stack.length > 0 && objects.length <= limit) {
      const dir = stack.pop()!;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        const relativeKey = relative(this.basePath, fullPath);
        if (prefix && !relativeKey.startsWith(prefix)) continue;
        const stats = statSync(fullPath);
        objects.push({ key: relativeKey, size: stats.size, lastModified: stats.mtime });
      }
    }

    return {
      objects: objects.slice(0, limit),
      hasMore: objects.length > limit,
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
