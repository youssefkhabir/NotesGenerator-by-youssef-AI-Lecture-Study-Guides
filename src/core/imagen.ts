/**
 * Imagen 3 client for generating conceptual illustrations of analogies.
 *
 * Uses Google AI Studio / Gemini API key to call the Imagen prediction endpoint.
 */

export interface ImagenResult {
  dataUrl: string;
  prompt: string;
}

export async function generateAnalogyIllustration(params: {
  apiKey: string;
  concept: string;
  analogy: string;
}): Promise<ImagenResult> {
  const { apiKey, concept, analogy } = params;

  if (!apiKey) {
    throw new Error("Gemini API key is required to generate illustrations.");
  }

  // Craft an educational, clear illustration prompt
  const fullPrompt = `An educational, clean, high-quality digital illustration representing the concept "${concept}". Visual metaphor: "${analogy}". Minimalist textbook graphic style, clear lighting, beautiful composition, no messy or unreadable text.`;

  const models = ["imagen-3.0-generate-002", "imagen-3.0-fast-generate-001"];
  let lastError: Error | null = null;

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${encodeURIComponent(
      apiKey
    )}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt: fullPrompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: "16:9",
            outputMimeType: "image/jpeg",
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        if (response.status === 404) {
          lastError = new Error(`Model ${model} not available on this API key.`);
          continue;
        }
        throw new Error(`Imagen error (HTTP ${response.status}): ${errorText}`);
      }

      const json = await response.json();
      const base64Bytes = json.predictions?.[0]?.bytesBase64Encoded;
      const mimeType = json.predictions?.[0]?.mimeType || "image/jpeg";

      if (!base64Bytes) {
        throw new Error("No image data returned from Imagen.");
      }

      return {
        dataUrl: `data:${mimeType};base64,${base64Bytes}`,
        prompt: fullPrompt,
      };
    } catch (err: unknown) {
      lastError = err as Error;
    }
  }

  throw lastError || new Error("Failed to generate illustration with Imagen.");
}
