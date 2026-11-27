import dotenv from "dotenv";
import axios from "axios";
import { uploadVideoToCloudinary } from "./cloudinary.service";
import { buildVideoPrompt } from "./videoPromptBuilder";
import { generateVideoWithComfy, getComfyApiUrl } from "./comfy.service";
import { getVideoGenerationTimeoutMs } from "../config/timeouts";
import { logger } from "../utils/logger";

dotenv.config();

export interface GenerateVideoModelOptions {
  imageUrl: string;
  occasion: string;
  theme?: string;
  customMessage?: string;
  people?: string[];
  decorations?: string[];
  additionalInformation?: string;
  prompt?: string;
  duration?: number;
  motionStyle?: string;
  aiEngine?: string;
}

export interface VideoModelResult {
  videoUrl: string;
  duration: number;
  mimeType: string;
  model: string;
  tier: "ai-video" | "animated-card";
}

async function getImageBase64(imageInput: string): Promise<{ base64: string; mimeType: string }> {
  if (imageInput.startsWith("data:")) {
    const matches = imageInput.match(/^data:(.+?);base64,(.+)$/);
    if (matches) {
      return { mimeType: matches[1], base64: matches[2] };
    }
  }

  // If it's a URL (e.g. Cloudinary or Web URL), fetch it and convert to base64
  const res = await axios.get(imageInput, { responseType: "arraybuffer", timeout: 20000 });
  const contentType = (res.headers["content-type"] as string) || "image/png";
  const base64 = Buffer.from(res.data).toString("base64");
  return { base64, mimeType: contentType };
}

/**
 * Primary Video Generator: Google gemini-omni-1.2-flash via Interactions API
 */
export async function generateVideoWithGeminiOmni(
  options: GenerateVideoModelOptions
): Promise<VideoModelResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in backend/.env");
  }

  const {
    imageUrl,
    occasion,
    theme = "",
    customMessage = "",
    people = [],
    decorations = [],
    additionalInformation = "",
    prompt: customPrompt = "",
    duration = 8,
    motionStyle = "cinematic-bokeh",
  } = options;

  const effectiveDuration = Math.min(8, Math.max(4, Math.round(duration)));

  const prompt = buildVideoPrompt({
    duration: effectiveDuration,
    motionStyle,
    occasion,
  });

  logger.info(
    { model: "gemini-omni-1.2-flash", occasion, duration: effectiveDuration, promptLength: prompt.length },
    "Dispatching image-to-video generation to gemini-omni-1.2-flash with motion prompt"
  );

  const { base64, mimeType } = await getImageBase64(imageUrl);

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/interactions`,
    {
      model: "gemini-omni-1.2-flash",
      input: [
        {
          type: "image",
          data: base64,
          mime_type: mimeType,
        },
        {
          type: "text",
          text: prompt,
        },
      ],
    },
    {
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      timeout: getVideoGenerationTimeoutMs(),
    }
  );

  const data = response.data;
  if (!data || !data.steps) {
    throw new Error("Invalid response format from Gemini Interactions API");
  }

  // Find the video item in model_output steps
  let videoBase64: string | null = null;
  let videoMime: string = "video/mp4";

  for (const step of data.steps) {
    if (step.type === "model_output" && Array.isArray(step.content)) {
      for (const item of step.content) {
        if (item.type === "video" && item.data) {
          videoBase64 = item.data;
          videoMime = item.mime_type || "video/mp4";
          break;
        }
      }
    }
    if (videoBase64) break;
  }

  if (!videoBase64) {
    throw new Error("No video stream returned by gemini-omni-1.2-flash");
  }

  logger.info(
    { sizeBytes: videoBase64.length },
    "gemini-omni-1.2-flash video generated successfully. Uploading MP4 to Cloudinary CDN..."
  );

  const secureUrl = await uploadVideoToCloudinary(
    `data:${videoMime};base64,${videoBase64}`
  );

  return {
    videoUrl: secureUrl,
    duration: effectiveDuration,
    mimeType: videoMime,
    model: "Google gemini-omni-1.2-flash",
    tier: "ai-video",
  };
}

/**
 * Strict 2-Model Video Dispatcher (No Automatic Fallback):
 * 1. FLUX / SVD (`svd` | `comfy` | `flux`) -> ComfyUI SVD XT 1.1 (4-8s MP4)
 * 2. Gemini (`gemini` | `gemini-omni` | `video-model` | default) -> Google gemini-omni-1.2-flash (4-8s MP4)
 *
 * If the selected engine fails, throws a clear error advising the user to try another model.
 */
export async function generateVideoWithModel(
  options: GenerateVideoModelOptions
): Promise<VideoModelResult> {
  const isFluxOrSvdRequested =
    options.aiEngine === "svd" ||
    options.aiEngine === "comfy" ||
    options.aiEngine === "flux";

  // 1. STRICT FLUX / SVD PATH (ComfyUI SVD XT 1.1)
  if (isFluxOrSvdRequested) {
    if (!getComfyApiUrl()) {
      throw new Error(
        "FLUX / SVD video generation failed: COMFY_API_URL is not configured. Please try again or switch to another AI video model."
      );
    }

    try {
      logger.info({ model: "svd_xt_1_1", aiEngine: options.aiEngine }, "Strict FLUX/SVD video requested; routing to ComfyUI");
      return await generateVideoWithComfy(options);
    } catch (svdErr: unknown) {
      const reason = svdErr instanceof Error ? svdErr.message : String(svdErr);
      logger.error({ err: reason }, "ComfyUI SVD video generation failed (no automatic fallback)");
      throw new Error(
        `FLUX / SVD video generation failed: ${reason}. Please try again or switch to another AI video model.`
      );
    }
  }

  // 2. STRICT GEMINI PATH (gemini-omni-1.2-flash)
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "Gemini video generation failed: GEMINI_API_KEY is not configured. Please try again or switch to another AI video model."
    );
  }

  try {
    return await generateVideoWithGeminiOmni(options);
  } catch (geminiErr: unknown) {
    const reason = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
    logger.error({ err: reason }, "Gemini video generation failed (no automatic fallback)");
    throw new Error(
      `Gemini video generation failed: ${reason}. Please try again or switch to another AI video model.`
    );
  }
}
