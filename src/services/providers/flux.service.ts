import dotenv from "dotenv";
import axios from "axios";
import sharp from "sharp";
import { InferenceClient } from "@huggingface/inference";
import { generateImageWithComfy, getComfyApiUrl } from "../comfy.service";
import { getImageGenerationTimeoutMs } from "../../config/timeouts";
import { logger } from "../../utils/logger";

dotenv.config();

export interface FluxResult {
  base64: string;
  mimeType: string;
  provider: string;
}

export async function generateWithFlux(
  prompt: string,
  uploadedImage?: string,
): Promise<FluxResult> {
  // 1. Primary: ComfyUI Endpoint (FLUX-2 Klein 4B / FLUX INT8)
  const comfyUrl = getComfyApiUrl();
  if (comfyUrl) {
    try {
      logger.info({ url: comfyUrl }, "Routing image generation request to ComfyUI endpoint");
      const comfyResult = await generateImageWithComfy(prompt, uploadedImage);
      logger.info("Successfully received generated image from ComfyUI");
      return {
        ...comfyResult,
        provider: "flux-comfy",
      };
    } catch (comfyErr: unknown) {
      const err = comfyErr as Error;
      logger.warn(
        { err: err.message },
        "ComfyUI image generation failed; falling back to secondary providers"
      );
    }
  }

  const fluxApiUrl = process.env.FLUX_API_URL?.trim();

  // 2. Self-hosted FLUX endpoint (Colab GPU / custom tunnel)
  if (fluxApiUrl) {
    try {
      logger.info({ url: fluxApiUrl }, "Routing FLUX request to custom FLUX endpoint");

      const executeColabRequest = async () => {
        return axios.post<string | { image?: string; mime_type?: string; error?: string }>(
          `${fluxApiUrl}/generate`,
          {
            prompt,
            image: uploadedImage,
          },
          {
            headers: { "Content-Type": "application/json" },
            timeout: getImageGenerationTimeoutMs(),
            responseType: "text",
          },
        );
      };

      let res;
      try {
        res = await executeColabRequest();
      } catch (err: unknown) {
        const axiosErr = err as { response?: { status?: number; data?: unknown }; message?: string };
        const isGpuBusy =
          axiosErr.response?.status === 503 ||
          (typeof axiosErr.response?.data === "string" && axiosErr.response.data.includes("gpu_busy")) ||
          (typeof axiosErr.response?.data === "object" && (axiosErr.response?.data as { error?: string })?.error === "gpu_busy") ||
          (axiosErr.message && axiosErr.message.includes("gpu_busy"));

        if (isGpuBusy) {
          const retryDelay = process.env.GPU_RETRY_DELAY_MS ? parseInt(process.env.GPU_RETRY_DELAY_MS, 10) : 20000;
          logger.warn({ retryDelay }, "Colab FLUX GPU returned 503 gpu_busy. Waiting before retrying once...");
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          res = await executeColabRequest();
        } else {
          throw err;
        }
      }

      let rawData = res.data;
      let parsed: { image?: string; mime_type?: string; error?: string } =
        typeof rawData === "string" ? JSON.parse(rawData.trim()) : rawData;

      if (parsed.error === "gpu_busy") {
        const retryDelay = process.env.GPU_RETRY_DELAY_MS ? parseInt(process.env.GPU_RETRY_DELAY_MS, 10) : 20000;
        logger.warn({ retryDelay }, "Colab FLUX GPU reported gpu_busy in payload. Waiting before retrying once...");
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        res = await executeColabRequest();
        rawData = res.data;
        parsed = typeof rawData === "string" ? JSON.parse(rawData.trim()) : rawData;
      }

      if (parsed.error) {
        throw new Error(parsed.error);
      }

      if (parsed && parsed.image) {
        logger.info("Successfully received generated image from Colab FLUX GPU");
        return {
          base64: parsed.image,
          mimeType: parsed.mime_type || "image/png",
          provider: "flux-colab",
        };
      }
    } catch (apiErr: unknown) {
      const err = apiErr as { response?: { status?: number; data?: unknown }; message?: string };
      let detail: unknown = err.response?.data || err.message;
      if (typeof detail === "string") {
        try {
          detail = JSON.parse(detail.trim());
        } catch {
          // keep string
        }
      }
      logger.warn(
        { status: err.response?.status, err: detail },
        "Custom FLUX endpoint unreachable or failed; falling back to Hugging Face FLUX.1-Kontext-dev",
      );
    }
  }

  // 3. Hugging Face Inference Client (black-forest-labs/FLUX.1-Kontext-dev)
  const hfToken = process.env.HF_TOKEN?.trim();
  const fluxModel = process.env.FLUX_MODEL?.trim() || "black-forest-labs/FLUX.1-Kontext-dev";

  if (hfToken) {
    try {
      const client = new InferenceClient(hfToken);
      logger.info({ model: fluxModel }, "Executing FLUX image-to-image generation via Hugging Face Inference");

      let imageBlob: Blob;

      if (uploadedImage) {
        const matches = uploadedImage.match(/^data:(.+);base64,(.+)$/);
        if (!matches) {
          throw new Error("Invalid image format");
        }
        const mimeType = matches[1];
        const imageBuffer = Buffer.from(matches[2], "base64");
        imageBlob = new Blob([imageBuffer], { type: mimeType }) as unknown as Blob;
      } else {
        const blankBuffer = await sharp({
          create: {
            width: 1024,
            height: 1024,
            channels: 3,
            background: { r: 24, g: 32, b: 32 },
          },
        })
          .png()
          .toBuffer();
        imageBlob = new Blob([new Uint8Array(blankBuffer)], { type: "image/png" }) as unknown as Blob;
      }

      const result = await client.imageToImage({
        model: fluxModel,
        inputs: imageBlob,
        parameters: {
          prompt,
        },
      });

      const outputBuffer = Buffer.from(await result.arrayBuffer());

      return {
        base64: outputBuffer.toString("base64"),
        mimeType: "image/png",
        provider: "flux-huggingface",
      };
    } catch (hfErr: unknown) {
      const errMsg = hfErr instanceof Error ? hfErr.message : String(hfErr);
      logger.warn(
        { err: errMsg, model: fluxModel },
        "Hugging Face FLUX Inference Provider failed",
      );
      throw hfErr;
    }
  }

  throw new Error("No FLUX endpoint or HF_TOKEN available");
}
