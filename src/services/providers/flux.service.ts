import dotenv from "dotenv";
import axios from "axios";
import { InferenceClient } from "@huggingface/inference";
import { logger } from "../../utils/logger";

dotenv.config();

const client = new InferenceClient(process.env.HF_TOKEN);
const FLUX_API_URL = (process.env.FLUX_API_URL || process.env.CUSTOM_MODEL_URL)?.trim();

export interface FluxResult {
  base64: string;
  mimeType: string;
}

export async function generateWithFlux(
  prompt: string,
  uploadedImage?: string,
): Promise<FluxResult> {
  if (!uploadedImage) {
    throw new Error("Uploaded image required");
  }

  // 1. If self-hosted FLUX server on Colab GPU is running, route directly to it!
  if (FLUX_API_URL) {
    try {
      logger.info({ url: FLUX_API_URL }, "Routing FLUX request to self-hosted Colab GPU");
      const res = await axios.post<{ image?: string; mime_type?: string }>(
        `${FLUX_API_URL}/generate`,
        {
          prompt,
          image: uploadedImage,
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 180000, // 3 minutes timeout for heavy diffusion
        },
      );

      if (res.data && res.data.image) {
        return {
          base64: res.data.image,
          mimeType: res.data.mime_type || "image/png",
        };
      }
    } catch (apiErr: unknown) {
      const err = apiErr as { response?: { data?: { detail?: string } }; message?: string };
      logger.error({ err: err.response?.data || err.message }, "Colab FLUX API error");
      throw new Error(`Self-hosted FLUX Colab server error: ${err.response?.data?.detail || err.message}`);
    }
  }

  // 2. Fallback to Hugging Face Inference Client
  const matches = uploadedImage.match(/^data:(.+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid image format");
  }

  const mimeType = matches[1];
  const imageBuffer = Buffer.from(matches[2], "base64");
  const imageBlob = new Blob([imageBuffer], { type: mimeType }) as unknown as Blob;

  const result = await client.imageToImage({
    model: "black-forest-labs/flux-3-image-klein",
    inputs: imageBlob,
    parameters: {
      prompt,
    },
  });

  const outputBuffer = Buffer.from(await result.arrayBuffer());

  return {
    base64: outputBuffer.toString("base64"),
    mimeType: "image/png",
  };
}
