/**
 * OpenRouter API client for Chrome Extension.
 *
 * Implements structured JSON generation using OpenAI-compatible /chat/completions endpoint
 * for models like google/gemma-4-26b-a4b-it:free.
 */

import { LLMClient, LLMError, parseJsonCleanly, TokenStats, TruncationError } from "./gemini";

const DEFAULT_START_BUDGET = 8192;
const ESCALATED_BUDGET = 32768;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export class OpenRouterClient implements LLMClient {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private maxAttempts: number;

  public stats: TokenStats = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    truncations: 0,
  };

  constructor(options: {
    apiKey: string;
    model?: string;
    temperature?: number;
    maxAttempts?: number;
  }) {
    if (!options.apiKey) {
      throw new LLMError("OpenRouter API key is required. Please set it in Extension Settings.");
    }
    this.apiKey = options.apiKey.trim();
    this.model = options.model || "google/gemma-4-26b-a4b-it:free";
    this.temperature = options.temperature ?? 0.2;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  public async structured<T>(params: {
    prompt: string;
    schema: Record<string, unknown>;
    systemInstruction?: string;
    maxOutputTokens?: number;
  }): Promise<T> {
    let budget = params.maxOutputTokens || DEFAULT_START_BUDGET;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const result = await this.callApiOnce<T>(
          params.prompt,
          params.schema,
          params.systemInstruction,
          budget
        );
        return result;
      } catch (err: unknown) {
        if (err instanceof TruncationError) {
          this.stats.truncations++;
          if (budget < ESCALATED_BUDGET) {
            budget = ESCALATED_BUDGET;
            console.warn(`[OpenRouterClient] Output truncated. Escalating budget to ${budget} tokens and retrying...`);
            continue;
          }
          throw err;
        }

        const isRetryable =
          err instanceof Error &&
          (err.message.includes("429") ||
            err.message.includes("503") ||
            err.message.includes("502") ||
            err.message.includes("fetch failed") ||
            err.message.includes("network") ||
            err.message.includes("Rate limit"));

        if (isRetryable && attempt < this.maxAttempts) {
          const delay = Math.min(30000, Math.pow(2, attempt - 1) * 2000 + Math.random() * 1000);
          console.warn(
            `[OpenRouterClient] Attempt ${attempt} failed (${(err as Error).message}). Retrying in ${(delay / 1000).toFixed(1)}s...`
          );
          await new Promise((res) => setTimeout(res, delay));
          continue;
        }

        throw err;
      }
    }

    throw new LLMError(`OpenRouter failed after ${this.maxAttempts} attempts.`);
  }

  private async callApiOnce<T>(
    prompt: string,
    schema: Record<string, unknown>,
    systemInstruction: string | undefined,
    budget: number
  ): Promise<T> {
    const url = "https://openrouter.ai/api/v1/chat/completions";

    const schemaStr = JSON.stringify(schema, null, 2);
    const systemPrompt = [
      systemInstruction || "You are an expert AI study notes and revision guide generator.",
      "CRITICAL OUTPUT FORMAT INSTRUCTION:",
      "You must respond ONLY with a single valid JSON object strictly conforming to this JSON schema:",
      schemaStr,
      "Do NOT output markdown backticks (```json), commentary, greetings, or text before or after the JSON.",
    ].join("\n\n");

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ];

    const bodyPayload = {
      model: this.model,
      messages,
      temperature: this.temperature,
      max_tokens: budget,
      response_format: { type: "json_object" },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://github.com/youssefkhabir/NotesGenerator-by-youssef-AI-Lecture-Study-Guides",
        "X-Title": "NotesGenerator by Youssef",
      },
      body: JSON.stringify(bodyPayload),
    });

    this.stats.calls++;

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      if (RETRYABLE_STATUS_CODES.has(response.status)) {
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      if (response.status === 401 || (response.status === 400 && errorText.includes("key"))) {
        throw new LLMError("Invalid OpenRouter API key. Please check your key in Extension Settings.");
      }
      if (response.status === 429) {
        throw new LLMError("OpenRouter rate limit or daily quota reached. Please wait or check your OpenRouter account.");
      }
      throw new LLMError(`OpenRouter API error (HTTP ${response.status}): ${errorText}`);
    }

    const json = await response.json();

    const usage = json.usage;
    if (usage) {
      this.stats.inputTokens += usage.prompt_tokens || 0;
      this.stats.outputTokens += usage.completion_tokens || 0;
    }

    const choice = json.choices?.[0];
    if (!choice || !choice.message) {
      throw new LLMError("OpenRouter returned empty choices. Content may have been filtered.");
    }

    if (choice.finish_reason === "length") {
      throw new TruncationError(`Response hit token limit of ${budget} tokens.`);
    }

    const rawContent = choice.message.content;
    if (!rawContent) {
      throw new LLMError("OpenRouter model returned empty message content.");
    }

    try {
      return parseJsonCleanly<T>(rawContent);
    } catch (parseErr) {
      throw new LLMError(
        `Failed to parse model JSON: ${(parseErr as Error).message}\nRaw text: ${rawContent.slice(0, 300)}`
      );
    }
  }
}
