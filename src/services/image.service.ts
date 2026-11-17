import { generateWithGemini } from "./providers/gemini.service";
import { generateWithFlux } from "./providers/flux.service";
import { logger } from "../utils/logger";

export interface GeneratedImage {
  base64: string;
  mimeType: string;
}

export async function generateImage(
  prompt: string,
  uploadedImage?: string,
  aiEngine?: string,
): Promise<GeneratedImage> {
  logger.debug({ aiEngine }, "Dispatching image generation request");

  switch (aiEngine?.toLowerCase()) {
    case "flux":
      return await generateWithFlux(prompt, uploadedImage);

    case "gemini":
    default:
      return await generateWithGemini(prompt, uploadedImage);
  }
}
