/**
 * Gemini API client for Chrome Extension.
 *
 * Implements structured JSON generation, automatic budget escalation (8k -> 32k)
 * when thinking tokens eat the output limit, and backoff retries.
 */

export class LLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMError";
  }
}

export class TruncationError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "TruncationError";
  }
}

export interface TokenStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  truncations: number;
}

export interface LLMClient {
  stats: TokenStats;
  structured<T>(params: {
    prompt: string;
    schema: Record<string, unknown>;
    systemInstruction?: string;
    maxOutputTokens?: number;
  }): Promise<T>;
}

export function parseJsonCleanly<T>(raw: string): T {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return JSON.parse(cleaned) as T;
}

const DEFAULT_START_BUDGET = 8192;
const ESCALATED_BUDGET = 32768;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export class GeminiClient implements LLMClient {
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
      throw new LLMError("Gemini API key is required. Please set it in Extension Settings.");
    }
    this.apiKey = options.apiKey;
    this.model = options.model || "gemini-2.5-flash";
    this.temperature = options.temperature ?? 0.2;
    this.maxAttempts = options.maxAttempts ?? 4;
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
            console.warn(`[GeminiClient] Output truncated. Escalating budget to ${budget} tokens and retrying...`);
            continue;
          }
          throw err;
        }

        const isRetryable =
          err instanceof Error &&
          (err.message.includes("429") ||
            err.message.includes("503") ||
            err.message.includes("fetch failed") ||
            err.message.includes("network"));

        if (isRetryable && attempt < this.maxAttempts) {
          const delay = Math.min(30000, Math.pow(2, attempt - 1) * 1500 + Math.random() * 1000);
          console.warn(`[GeminiClient] Attempt ${attempt} failed (${(err as Error).message}). Retrying in ${(delay / 1000).toFixed(1)}s...`);
          await new Promise((res) => setTimeout(res, delay));
          continue;
        }

        throw err;
      }
    }

    throw new LLMError(`Failed after ${this.maxAttempts} attempts.`);
  }

  private async callApiOnce<T>(
    prompt: string,
    schema: Record<string, unknown>,
    systemInstruction: string | undefined,
    budget: number
  ): Promise<T> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(
      this.apiKey
    )}`;

    const bodyPayload: Record<string, unknown> = {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: this.temperature,
        maxOutputTokens: budget,
      },
    };

    if (systemInstruction) {
      bodyPayload.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
    });

    this.stats.calls++;

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      if (RETRYABLE_STATUS_CODES.has(response.status)) {
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      if (response.status === 400 && errorText.includes("API_KEY_INVALID")) {
        throw new LLMError("Invalid Gemini API key. Please check your key in Extension Settings.");
      }
      throw new LLMError(`Gemini API error (HTTP ${response.status}): ${errorText}`);
    }

    const json = await response.json();

    // Usage Accounting
    const usage = json.usageMetadata;
    if (usage) {
      this.stats.inputTokens += usage.promptTokenCount || 0;
      this.stats.outputTokens += usage.candidatesTokenCount || 0;
      this.stats.thoughtTokens += usage.thoughtsTokenCount || 0;
    }

    const candidate = json.candidates?.[0];
    if (!candidate) {
      throw new LLMError("Gemini returned empty candidates. Content may have been filtered.");
    }

    const finishReason = candidate.finishReason;

    if (finishReason === "MAX_TOKENS") {
      throw new TruncationError(
        `Response hit token limit of ${budget} tokens (billed with thinking tokens).`
      );
    }

    if (finishReason !== "STOP" && finishReason !== undefined) {
      throw new LLMError(`Model finished with unexpected reason: ${finishReason}.`);
    }

    const partText = candidate.content?.parts?.[0]?.text;
    if (!partText) {
      throw new LLMError("Candidate returned no text.");
    }

    try {
      return parseJsonCleanly<T>(partText);
    } catch (parseErr) {
      throw new LLMError(`Failed to parse model JSON: ${(parseErr as Error).message}\nRaw text: ${partText.slice(0, 200)}`);
    }
  }
}
