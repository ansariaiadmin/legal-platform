import { ConfigService } from '@nestjs/config';
import { MockAIAdapter } from '../../src/providers/ai/mock-ai.adapter';

interface AIContractTests {
  generateTextWithCitations: () => Promise<boolean>;
  embeddingDimensionConsistency: () => Promise<boolean>;
  configHealthReporting: () => Promise<boolean>;
}

export function runAiContractTests(configService?: ConfigService): AIContractTests {
  const adapter = new MockAIAdapter(configService || new ConfigService());

  return {
    async generateTextWithCitations(): Promise<boolean> {
      try {
        const result = await adapter.generateText({
          prompt: 'Test prompt',
          context: ['Context 1', 'Context 2'],
          requireCitations: true,
        });
        return !!result.text && !!result.citations && result.citations.length > 0;
      } catch {
        return false;
      }
    },

    async embeddingDimensionConsistency(): Promise<boolean> {
      try {
        const result = await adapter.embedText({ text: 'Test text' });
        return result.embedding.length === result.dimension && result.dimension > 0;
      } catch {
        return false;
      }
    },

    async configHealthReporting(): Promise<boolean> {
      try {
        const health = await adapter.verifyConfig();
        // In development, mock should be valid
        return process.env.NODE_ENV !== 'production' ? health.valid === true : true;
      } catch {
        return false;
      }
    },
  };
}
