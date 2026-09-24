import {
  AIProvider,
  TextGenerationResult,
  EmbeddingResult,
  AIProviderMetadata,
  TokenUsage,
} from './ai.provider';
import { ConfigService } from '@nestjs/config';

export class MockAIAdapter implements AIProvider {
  constructor(private readonly configService: ConfigService) {}

  async generateText(input: {
    prompt: string;
    systemPrompt?: string;
    context?: string[];
    temperature?: number;
    maxTokens?: number;
    requireCitations?: boolean;
  }): Promise<TextGenerationResult> {
    const maxTokens = input.maxTokens ?? 500;
    
    // Deterministic canned response based on prompt length
    const responseText = `This is a mock AI response. The prompt was ${input.prompt.length} characters long. In a real implementation, this would generate meaningful content based on the prompt and context.`;
    
    const truncatedText = responseText.slice(0, maxTokens * 4); // Approximate char count
    
    const usage: TokenUsage = {
      promptTokens: Math.ceil((input.prompt.length + (input.context?.join(' ').length ?? 0)) / 4),
      completionTokens: Math.ceil(truncatedText.length / 4),
      totalTokens: 0,
    };
    usage.totalTokens = usage.promptTokens + usage.completionTokens;

    const result: TextGenerationResult = {
      text: truncatedText,
      model: 'mock-generation-v1',
      usage,
      finishReason: 'stop',
    };

    if (input.requireCitations && input.context && input.context.length > 0) {
      result.citations = [
        {
          text: 'Mock citation from context',
          sourceId: 'mock-source-1',
          url: 'https://example.com/mock-source',
        },
      ];
    }

    return result;
  }

  async embedText(input: { text: string; model?: string }): Promise<EmbeddingResult> {
    // 0 means "not configured"; generation still needs a usable vector size.
    const configured = this.embeddingDimension();
    const dimension = configured > 0 ? configured : 1024;
    const embedding = this.generateDeterministicEmbedding(input.text, dimension);
    
    const usage: TokenUsage = {
      promptTokens: Math.ceil(input.text.length / 4),
      completionTokens: 0,
      totalTokens: Math.ceil(input.text.length / 4),
    };

    return {
      embedding,
      dimension,
      model: input.model ?? 'mock-embedding-v1',
      usage,
    };
  }

  async verifyConfig(): Promise<{ valid: boolean; error?: string }> {
    if (process.env.NODE_ENV === 'production') {
      return {
        valid: false,
        error: 'Mock AI provider cannot be used in production',
      };
    }
    
    const dimension = this.embeddingDimension();
    if (!dimension || dimension <= 0) {
      return {
        valid: false,
        error: 'AI_EMBEDDING_DIMENSION must be configured',
      };
    }
    
    return { valid: true };
  }

  getMetadata(): AIProviderMetadata {
    const configured = this.embeddingDimension();
    const dimension = configured > 0 ? configured : 1024;
    
    return {
      name: 'Mock AI Provider',
      models: ['mock-generation-v1', 'mock-embedding-v1'],
      capabilities: {
        supportsStreaming: false,
        maxContextLength: 4096,
        supportedTasks: ['text-generation', 'embeddings'],
      },
      defaultEmbeddingDimension: dimension,
    };
  }

  /**
   * `process.env` values are always strings, so `get<number>()` does NOT coerce.
   * Without Number() the dimension leaked as "1024" and broke the contract
   * `embedding.length === dimension`.
   */
  private embeddingDimension(): number {
    const raw = this.configService.get<number | string>('AI_EMBEDDING_DIMENSION');
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }

  private generateDeterministicEmbedding(text: string, dimension: number): number[] {
    // Simple deterministic embedding using text hash
    const hash = this.hashString(text);
    const embedding: number[] = [];
    
    for (let i = 0; i < dimension; i++) {
      // Generate pseudo-random value between -1 and 1 based on hash
      const seed = (hash + i * 17) % 1000;
      embedding.push((seed / 500) - 1);
    }
    
    // Normalize the embedding vector
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < dimension; i++) {
        embedding[i] /= magnitude;
      }
    }
    
    return embedding;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}
