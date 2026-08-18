import { ProviderError } from '../provider.error';

export interface StorageObject {
  key: string;
  size: number;
  contentType?: string;
  lastModified: Date;
  metadata?: Record<string, string>;
}

export interface StorageListResult {
  objects: StorageObject[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface StorageProviderConfig {
  endpoint?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  localPath?: string;
}

export interface StorageProviderMetadata {
  name: string;
  driverType: 's3' | 'local' | 'gcs' | 'azure';
  maxFileSize?: number;
  supportedContentTypes?: string[];
}

export interface StorageProvider {
  put(input: {
    key: string;
    content: Buffer | string;
    contentType?: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string; key: string }>;

  get(key: string): Promise<Buffer>;

  delete(key: string): Promise<void>;

  list(input: { prefix?: string; cursor?: string; limit?: number }): Promise<StorageListResult>;

  verifyConfig(): Promise<{ valid: boolean; error?: string }>;

  getMetadata(): StorageProviderMetadata;
}

export { ProviderError };
