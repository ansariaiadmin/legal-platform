import { ProviderError } from '../provider.error';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface EmbeddingResult {
  embedding: number[];
  dimension: number;
  model: string;
  usage?: TokenUsage;
}

export interface TextGenerationResult {
  text: string;
  model: string;
  usage?: TokenUsage;
  citations?: Array<{ text: string; sourceId: string; url?: string }>;
  finishReason?: 'stop' | 'length' | 'content_filter';
}

export interface ModelCapability {
  supportsStreaming: boolean;
  maxContextLength: number;
  supportedTasks: string[];
}

export interface AIProviderMetadata {
  name: string;
  models: string[];
  capabilities: ModelCapability;
  defaultEmbeddingDimension: number;
}

export interface AIProviderConfig {
  baseUrl: string;
  apiKey: string;
  embeddingDimension: number;
  generationModel?: string;
  embeddingModel?: string;
}

export interface AIProvider {
  generateText(input: {
    prompt: string;
    systemPrompt?: string;
    context?: string[];
    temperature?: number;
    maxTokens?: number;
    requireCitations?: boolean;
  }): Promise<TextGenerationResult>;

  embedText(input: { text: string; model?: string }): Promise<EmbeddingResult>;

  verifyConfig(): Promise<{ valid: boolean; error?: string }>;

  getMetadata(): AIProviderMetadata;
}

export { ProviderError };


