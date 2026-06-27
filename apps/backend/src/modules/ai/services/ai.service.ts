import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Part 3: AI Pipeline - GLM (Zhipu AI / Z.ai) API client
// Primary LLM service for document processing
// GLM API Documentation: https://open.bigmodel.cn/dev/api
// Uses GLM-4-Flash for fast, cost-effective document processing

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  // Primary + fallback models, tried in order when the primary is unavailable.
  private readonly models: string[];
  private readonly maxTokens: number;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get('GLM_API_KEY') || '';
    this.baseUrl = this.configService.get('GLM_BASE_URL') || 'https://open.bigmodel.cn/api/paas/v4';
    this.model = this.configService.get('GLM_MODEL') || 'glm-4-flash';
    // glm-4.7-flash is a reasoning model: thinking tokens consume this budget too
    // 16384 gives enough room for reasoning + JSON extraction output
    this.maxTokens = 16384;

    // Fallback models tried when the primary is overloaded (429 / 5xx / timeout)
    // on Z.ai. glm-4.7-flash intermittently rate-limits in peak hours; glm-4.5-flash
    // is a free flash-family alternative. Override via GLM_FALLBACK_MODELS (csv).
    const fallbacks = (this.configService.get('GLM_FALLBACK_MODELS') || 'glm-4.5-flash')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    this.models = Array.from(new Set([this.model, ...fallbacks]));

    if (!this.apiKey) {
      this.logger.warn('GLM_API_KEY not set - AI features will be disabled');
    }
  }

  /**
   * Send a message to GLM and get the response
   * @param prompt - The prompt to send
   * @param systemPrompt - Optional system prompt
   * @returns Response text
   */
  /**
   * Single HTTP attempt against one model. Never throws for transient failures —
   * returns a discriminated result so the caller can decide to retry / fail over.
   * @returns ok with text+usage, or { ok:false, retryable, message }
   */
  private async callOnce(
    model: string,
    messages: ChatMessage[],
  ): Promise<
    | { ok: true; text: string; usage: { inputTokens: number; outputTokens: number } }
    | { ok: false; retryable: boolean; message: string }
  > {
    const controller = new AbortController();
    const timeout = 120000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: this.maxTokens,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Retry rate-limit (429) and server errors (5xx) by failing over to
        // another model. Client errors (4xx) are not retryable — a fallback model
        // won't fix a bad request / auth / unknown-model error.
        const errorText = await response.text();
        const retryable = response.status === 429 || response.status >= 500;
        this.logger.error(`GLM API error (${model}): ${response.status} - ${errorText}`);
        return {
          ok: false,
          retryable,
          message: `GLM API request failed: ${response.status}`,
        };
      }

      const data = (await response.json()) as ChatCompletionResponse;

      if (!data.choices || data.choices.length === 0) {
        return { ok: false, retryable: false, message: 'No response from GLM API' };
      }

      return {
        ok: true,
        text: data.choices[0].message.content,
        usage: {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);

      // The 120s AbortController fires when Z.ai hangs (glm-4.7-flash reasoning
      // calls can run past 120s before returning/500ing) — retryable via failover.
      const isTimeout =
        error instanceof Error &&
        (error.name === 'AbortError' || error.message.toLowerCase().includes('timed out'));
      if (isTimeout) {
        this.logger.error(`GLM API request timed out after 120s (${model})`);
        return { ok: false, retryable: true, message: 'AI request timed out - please try again' };
      }
      return {
        ok: false,
        retryable: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Send a request, iterating models on transient (429 / 5xx / timeout) failures.
   * Each model gets a small retry budget with backoff; when it is exhausted the
   * next fallback model is tried. Non-retryable client errors throw immediately.
   */
  private async fetchWithRetry(
    messages: ChatMessage[],
  ): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
    const attemptsPerModel = 2;
    let lastMessage = 'GLM API request failed after retries';

    for (const model of this.models) {
      for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
        const result = await this.callOnce(model, messages);

        if (result.ok) {
          if (model !== this.model) {
            this.logger.warn(
              `GLM request succeeded on fallback model ${model} (primary ${this.model} was unavailable)`,
            );
          }
          this.logger.debug(
            `GLM response received (${model}) - Input: ${result.usage.inputTokens}, Output: ${result.usage.outputTokens} tokens`,
          );
          return { text: result.text, usage: result.usage };
        }

        lastMessage = result.message;

        // Non-retryable (4xx client error / parse failure) — another model won't help.
        if (!result.retryable) {
          throw new Error(result.message);
        }

        // Retryable: backoff and retry the same model, then fail over to the next.
        if (attempt < attemptsPerModel) {
          const delay = Math.pow(2, attempt) * 3000;
          this.logger.warn(
            `GLM ${model} transient failure, retry ${attempt}/${attemptsPerModel} in ${delay}ms`,
          );
          await new Promise((r) => setTimeout(r, delay));
        } else if (this.models.length > 1) {
          this.logger.warn(
            `GLM ${model} exhausted (${attemptsPerModel} attempts) — failing over to next model`,
          );
        }
      }
    }

    throw new Error(lastMessage);
  }

  async sendMessage(
    prompt: string,
    systemPrompt?: string,
  ): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
    if (!this.apiKey) {
      throw new Error('GLM_API_KEY not configured');
    }

    try {
      this.logger.debug(`Sending message to GLM (${this.model})`);

      const messages: ChatMessage[] = [];

      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }

      messages.push({ role: 'user', content: prompt });

      return await this.fetchWithRetry(messages);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`GLM API error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Send a message and expect JSON response
   * @param prompt - The prompt to send
   * @param systemPrompt - Optional system prompt
   * @returns Parsed JSON response
   */
  async sendJsonMessage<T>(
    prompt: string,
    systemPrompt?: string,
  ): Promise<{ data: T; usage: { inputTokens: number; outputTokens: number } }> {
    // Add JSON instruction to prompt
    const jsonPrompt = `${prompt}

Return your response as a valid JSON object. Do not include any text outside the JSON.`;

    const response = await this.sendMessage(jsonPrompt, systemPrompt);

    try {
      // Extract JSON from response (handle potential markdown code blocks)
      let jsonText = response.text.trim();

      // Remove markdown code blocks if present
      if (jsonText.startsWith('```')) {
        const lines = jsonText.split('\n');
        // Remove first line (```json or ```) and last line (```)
        lines.pop();
        lines.shift();
        jsonText = lines.join('\n').trim();
      }

      const data = JSON.parse(jsonText) as T;

      return { data, usage: response.usage };
    } catch (error) {
      this.logger.error(`Failed to parse JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.logger.debug(`Response text: ${response.text}`);
      throw new Error(`Invalid JSON response from LLM: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if the AI service is available
   * @returns True if API key is configured
   */
  isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * Estimate cost of API call (in CNY)
   * Based on GLM pricing (https://open.bigmodel.cn/pricing)
   * @param inputTokens - Number of input tokens
   * @param outputTokens - Number of output tokens
   * @returns Estimated cost in CNY
   */
  estimateCost(inputTokens: number, outputTokens: number): number {
    // GLM-4-Flash pricing (as of 2024) - most cost-effective
    // Flash: ¥0.1 / 1M tokens (input), ¥0.1 / 1M tokens (output)
    // This is approximately $0.014 / 1M tokens

    const flashPricePerMillion = 0.1; // CNY per million tokens for Flash model

    // Adjust pricing based on model
    let priceMultiplier = 1;
    if (this.model.includes('plus')) {
      priceMultiplier = 10; // glm-4-plus is more expensive
    } else if (this.model.includes('air')) {
      priceMultiplier = 0.5; // glm-4-air is cheaper
    }

    const cost = (
      ((inputTokens + outputTokens) / 1_000_000) * flashPricePerMillion * priceMultiplier
    );

    return cost;
  }
}
