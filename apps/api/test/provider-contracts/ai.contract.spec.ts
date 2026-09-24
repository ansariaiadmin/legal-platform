import { ConfigService } from '@nestjs/config';
import { MockAIAdapter } from '../../src/providers/ai/mock-ai.adapter';

/**
 * AIProvider contract (SPEC section 8 and 9): generation can carry citations,
 * the embedding dimension is configurable and is never assumed to be 1536, and
 * health reporting tells the truth.
 */
describe('AIProvider contract', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalDimension = process.env.AI_EMBEDDING_DIMENSION;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    process.env.AI_EMBEDDING_DIMENSION = '768';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalDimension === undefined) {
      delete process.env.AI_EMBEDDING_DIMENSION;
    } else {
      process.env.AI_EMBEDDING_DIMENSION = originalDimension;
    }
  });

  it('returns text with usage accounting and a model name', async () => {
    const adapter = new MockAIAdapter(new ConfigService());

    const result = await adapter.generateText({ prompt: 'یک لایحهٔ کوتاه بنویس' });

    expect(result.text.length).toBeGreaterThan(0);
    expect(result.model).toEqual(expect.any(String));
    expect(result.usage?.totalTokens).toBe(
      (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0),
    );
  });

  it('attaches citations when they are required and context is supplied', async () => {
    const adapter = new MockAIAdapter(new ConfigService());

    const result = await adapter.generateText({
      prompt: 'مستند به قانون بنویس',
      context: ['مادهٔ ۱ قانون مدنی'],
      requireCitations: true,
    });

    expect(result.citations?.length).toBeGreaterThan(0);
    expect(result.citations?.[0].sourceId).toEqual(expect.any(String));
  });

  it('honours a configured embedding dimension that is not 1536', async () => {
    const adapter = new MockAIAdapter(new ConfigService());

    const result = await adapter.embedText({ text: 'قانون مجازات اسلامی' });

    expect(typeof result.dimension).toBe('number');
    expect(result.dimension).toBe(768);
    expect(result.embedding).toHaveLength(768);
  });

  it('produces a deterministic, unit-normalised embedding', async () => {
    const adapter = new MockAIAdapter(new ConfigService());

    const a = await adapter.embedText({ text: 'قرارداد بیع' });
    const b = await adapter.embedText({ text: 'قرارداد بیع' });

    expect(a.embedding).toEqual(b.embedding);

    const magnitude = Math.sqrt(a.embedding.reduce((sum, value) => sum + value * value, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it('reports unhealthy when the embedding dimension is not configured', async () => {
    delete process.env.AI_EMBEDDING_DIMENSION;
    const adapter = new MockAIAdapter(new ConfigService());

    const health = await adapter.verifyConfig();
    expect(health.valid).toBe(false);
    expect(health.error).toContain('AI_EMBEDDING_DIMENSION');
  });

  it('refuses to report healthy in production', async () => {
    process.env.NODE_ENV = 'production';
    const adapter = new MockAIAdapter(new ConfigService());

    expect((await adapter.verifyConfig()).valid).toBe(false);
  });
});
