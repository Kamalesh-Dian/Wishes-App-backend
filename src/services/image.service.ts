import { generateWithGemini } from "./providers/gemini.service";
import { generateWithFlux } from "./providers/flux.service";
import { logger } from "../utils/logger";

export interface GeneratedImage {
  base64: string;
  mimeType: string;
  provider: string;
}

export async function generateImage(
  prompt: string,
  uploadedImage?: string,
  aiEngine?: string,
): Promise<GeneratedImage> {
  const engine = (aiEngine || "gemini").toLowerCase();
  logger.debug({ engine }, "Dispatching image generation request");

  if (engine === "flux") {
    try {
      const fluxResult = await generateWithFlux(prompt, uploadedImage);
      return fluxResult;
    } catch (fluxErr) {
      logger.warn(
        { err: fluxErr instanceof Error ? fluxErr.message : fluxErr },
        "All FLUX providers failed; executing honest fallback to Gemini"
      );
      const geminiResult = await generateWithGemini(prompt, uploadedImage);
      return {
        ...geminiResult,
        provider: "gemini-fallback",
      };
    }
  }

  const geminiResult = await generateWithGemini(prompt, uploadedImage);
  return {
    ...geminiResult,
    provider: "gemini",
  };
}
