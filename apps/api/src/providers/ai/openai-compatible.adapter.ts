import { ConfigService } from '@nestjs/config';
import { ProviderError, PROVIDER_ERROR_CODES } from '../provider.error';
import type { AIProvider, AIProviderMetadata } from './ai.provider';

/**
 * P9-T3 REAL AI adapter — OpenAI-compatible HTTP (chat completions +
 * embeddings). The ports/routing layer (HybridInferenceRouter, ADR-004/011)
 * stays the SINGLE decision-maker; this adapter is the dumb, honest executor
 * it calls into.
 *
 * Honesty rules coded in:
 *  - usage/cost read verbatim from the response; if the vendor omits usage,
 *    we report `usage: undefined`, never an invented number;
 *  - NO retry logic here — the router owns retries and circuit decisions;
 *  - timeouts are mandatory; every HTTP error maps to typed ProviderError
 *    with retryable flags meaningful to the router;
 *  - keys travel ONLY in Authorization headers (never URL, never logs).
 */
export class OpenAiCompatibleAIAdapter implements AIProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly embModel: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    const baseUrl = config.get<string>('AI_BASE_URL')?.trim();
    const apiKey = config.get<string>('AI_API_KEY')?.trim();
    if (!baseUrl || !apiKey) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.CONFIG_INVALID,
        'OpenAI-compatible adapter needs AI_BASE_URL + AI_API_KEY (else stay on the mock adapter, honestly: AI_PROVIDER_KEY=mock)',
        false,
      );
    }
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.model = config.get<string>('AI_CLOUD_MODEL') || 'gpt-4o-mini';
    this.embModel = config.get<string>('AI_EMBEDDING_MODEL') || 'text-embedding-3-small';
    this.timeoutMs = Number(config.get<string>('AI_HTTP_TIMEOUT_MS')) || 30_000;
  }

  async generateText(input: {
    prompt: string;
    systemPrompt?: string;
    context?: string[];
    temperature?: number;
    maxTokens?: number;
    requireCitations?: boolean;
  }) {
    const body = {
      model: this.model,
      messages: [
        ...(input.systemPrompt ? [{ role: 'system' as const, content: input.systemPrompt }] : []),
        ...(input.context?.length
          ? [{ role: 'user' as const, content: `منابع:\n${input.context.join('\n')}` }]
          : []),
        { role: 'user' as const, content: input.prompt },
      ],
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxTokens ?? 900,
    };
    const data = await this.post('/v1/chat/completions', body) as { model?: string; usage?: Record<string, number>; choices?: Array<{ message?: { content?: string } }> };
    const choice = data.choices?.[0];
    const text: string = choice?.message?.content ?? '';
    if (!text) {
      throw new ProviderError(PROVIDER_ERROR_CODES.SERVICE_UNAVAILABLE, 'empty completion from provider', true);
    }
    return {
      text,
      model: typeof data.model === 'string' ? data.model : this.model,
      usage: data.usage
        ? {
            promptTokens: Number(data.usage.prompt_tokens) || 0,
            completionTokens: Number(data.usage.completion_tokens) || 0,
            totalTokens: Number(data.usage.total_tokens) || 0,
          }
        : undefined, // NEVER invented
    };
  }

  async embedText(input: { text: string; model?: string }) {
    const data = await this.post('/v1/embeddings', { model: input.model ?? this.embModel, input: input.text }) as { model?: string; usage?: Record<string, number>; data?: Array<{ embedding?: number[] }> };
    const emb = data.data?.[0]?.embedding;
    if (!Array.isArray(emb) || emb.length === 0) {
      throw new ProviderError(PROVIDER_ERROR_CODES.SERVICE_UNAVAILABLE, 'empty embedding', true);
    }
    return {
      embedding: emb as number[],
      dimension: (emb as number[]).length,
      model: input.model ?? this.embModel,
      usage: data.usage
        ? { promptTokens: Number(data.usage.prompt_tokens) || 0, completionTokens: 0, totalTokens: Number(data.usage.total_tokens) || 0 }
        : undefined,
    };
  }

  async verifyConfig(): Promise<{ valid: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok ? { valid: true } : { valid: false, error: `status ${res.status}` };
    } catch (e) {
      return { valid: false, error: (e as Error).message };
    }
  }

  getMetadata(): AIProviderMetadata {
    return {
      name: 'openai-compatible',
      models: [this.model, this.embModel],
      capabilities: { supportsStreaming: false, maxContextLength: 128_000, supportedTasks: ['generate', 'embed'] },
      defaultEmbeddingDimension: Number(this.config.get<string>('AI_EMBEDDING_DIMENSION')) || 1536,
    };
  }

  private async post(path: string, body: unknown): Promise<Record<string, never> & { choices?: unknown[]; data?: unknown[]; usage?: Record<string, number>; model?: string }> {
    const started = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const latency = Date.now() - started;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ProviderError(
          res.status === 429
            ? PROVIDER_ERROR_CODES.RATE_LIMITED
            : res.status >= 500
              ? PROVIDER_ERROR_CODES.SERVICE_UNAVAILABLE
              : res.status === 401 || res.status === 403
                ? PROVIDER_ERROR_CODES.AUTH_FAILED
                : PROVIDER_ERROR_CODES.INVALID_REQUEST,
          `AI ${res.status} in ${latency}ms: ${text.slice(0, 160)}`,
          res.status === 429 || res.status >= 500,
          { status: res.status },
        );
      }
      return (await res.json()) as never;
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(
        PROVIDER_ERROR_CODES.NETWORK_ERROR,
        `AI call failed after ${Date.now() - started}ms: ${(e as Error).message}`,
        true,
      );
    }
  }
}
