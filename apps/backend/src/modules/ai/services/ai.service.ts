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
  private readonly maxTokens: number;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get('GLM_API_KEY') || '';
    this.baseUrl = this.configService.get('GLM_BASE_URL') || 'https://open.bigmodel.cn/api/paas/v4';
    this.model = this.configService.get('GLM_MODEL') || 'glm-4-flash';
    // glm-4.7-flash is a reasoning model: thinking tokens consume this budget too
    // 16384 gives enough room for reasoning + JSON extraction output
    this.maxTokens = 16384;

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
  private async fetchWithRetry(
    messages: ChatMessage[],
    retries = 5,
  ): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
    for (let attempt = 1; attempt <= retries; attempt++) {
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
            model: this.model,
            messages,
            max_tokens: this.maxTokens,
            temperature: 0.3,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 429 && attempt < retries) {
          const delay = Math.pow(2, attempt) * 3000;
          this.logger.warn(`GLM 429 rate limit, retry ${attempt}/${retries} in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          this.logger.error(`GLM API error: ${response.status} - ${errorText}`);
          throw new Error(`GLM API request failed: ${response.status}`);
        }

        const data = (await response.json()) as ChatCompletionResponse;

        if (!data.choices || data.choices.length === 0) {
          throw new Error('No response from GLM API');
        }

        const text = data.choices[0].message.content;
        const usage = {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
        };

        this.logger.debug(
          `GLM response received - Input: ${usage.inputTokens}, Output: ${usage.outputTokens} tokens`,
        );

        return { text, usage };
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === 'AbortError') {
          this.logger.error('GLM API request timed out after 120s');
          throw new Error('AI request timed out - please try again');
        }
        throw error;
      }
    }

    throw new Error('GLM API request failed: 429');
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
