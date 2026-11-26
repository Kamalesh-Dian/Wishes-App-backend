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
      const reason = fluxErr instanceof Error ? fluxErr.message : String(fluxErr);
      logger.error(
        { err: reason },
        "FLUX image generation failed; not falling back automatically"
      );
      throw new Error(
        `FLUX image generation failed: ${reason}. Please try again or switch to another AI model.`
      );
    }
  }

  const geminiResult = await generateWithGemini(prompt, uploadedImage);
  return {
    ...geminiResult,
    provider: "gemini",
  };
}
