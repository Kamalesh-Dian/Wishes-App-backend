import dotenv from "dotenv";
import { logger } from "../../utils/logger";

dotenv.config();

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType?: string;
    data?: string;
  };
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
  error?: {
    message?: string;
    code?: number;
    status?: string;
  };
}

export interface GeneratedImageResult {
  base64: string;
  mimeType: string;
}

export async function generateWithGemini(
  prompt: string,
  uploadedImage?: string,
): Promise<GeneratedImageResult> {
  try {
    logger.debug("Starting Gemini image generation");

    const parts: GeminiPart[] = [];

    if (uploadedImage) {
      const matches = uploadedImage.match(/^data:(.+);base64,(.+)$/);

      if (!matches) {
        throw new Error("Invalid base64 image format");
      }

      const mimeType = matches[1];
      const base64Image = matches[2];

      logger.debug({ mimeType, size: base64Image.length }, "Attached reference image for Gemini");

      parts.push({
        inlineData: {
          mimeType,
          data: base64Image,
        },
      });
    }

    parts.push({
      text: prompt,
    });

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing");
    }

    logger.debug("Dispatching request to Gemini API");

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts,
            },
          ],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        }),
      },
    );

    const result = (await response.json()) as GeminiApiResponse;

    if (!response.ok) {
      logger.error({ status: response.status, err: result.error?.message }, "Gemini API returned error");
      throw new Error(result.error?.message || `HTTP ${response.status}`);
    }

    const candidate = result.candidates?.[0];

    if (!candidate) {
      throw new Error("No candidate returned by Gemini");
    }

    const imagePart = candidate.content?.parts?.find(
      (part: GeminiPart) => Boolean(part.inlineData?.data),
    );

    if (!imagePart?.inlineData?.data) {
      throw new Error("No image data returned in Gemini response");
    }

    logger.info("Gemini image generation completed successfully");

    return {
      base64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType || "image/png",
    };
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : error }, "Gemini generation failed");
    throw error;
  }
}
