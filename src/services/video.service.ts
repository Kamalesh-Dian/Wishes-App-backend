import dotenv from "dotenv";
import axios from "axios";
import { uploadToCloudinary, uploadVideoToCloudinary, generateDynamicMotionVideoUrl } from "./cloudinary.service";
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
 * Video Model Cascade:
 * 1. gemini-omni-1.2-flash (First choice: full text-to-video & prompt guidance)
 * 2. ComfyUI SVD XT 1.1 (Second choice: 3-4s video diffusion from image)
 * 3. Colab GPU Server (FLUX_API_URL / VIDEO_API_URL) if active
 * 4. Cloudinary Neural Motion Engine (Guaranteed fallback)
 */
export async function generateVideoWithModel(
  options: GenerateVideoModelOptions
): Promise<VideoModelResult> {
  const {
    imageUrl,
    occasion,
    theme = "",
    customMessage = "",
    duration = 8,
    motionStyle = "cinematic-bokeh",
  } = options;

  const effectiveDuration = Math.min(8, Math.max(4, Math.round(duration)));
  const isFluxOrSvdRequested =
    options.aiEngine === "svd" ||
    options.aiEngine === "comfy" ||
    options.aiEngine === "flux";

  // 0. STRICT FLUX / SVD MODE: If caller explicitly requested FLUX/SVD, stick to it — do NOT fall back to Gemini or Cloudinary
  if (isFluxOrSvdRequested) {
    let lastError = "No FLUX / ComfyUI SVD endpoint is configured";

    if (getComfyApiUrl()) {
      try {
        logger.info({ model: "svd_xt_1_1", aiEngine: options.aiEngine }, "Strict FLUX/SVD video requested; routing to ComfyUI");
        return await generateVideoWithComfy(options);
      } catch (svdErr: unknown) {
        const err = svdErr as Error;
        lastError = err.message || "ComfyUI SVD execution failed";
        logger.error({ err: lastError }, "ComfyUI SVD video generation failed");
      }
    }

    const fluxVideoUrl = (process.env.VIDEO_API_URL || process.env.FLUX_API_URL)?.trim();
    if (fluxVideoUrl) {
      try {
        logger.info({ url: fluxVideoUrl, duration: effectiveDuration }, "Dispatching strict FLUX/SVD video request to GPU Model Server");
        const prompt = buildVideoPrompt({
          duration: effectiveDuration,
          motionStyle,
          occasion,
        });
        const res = await axios.post<string | { video?: string; image?: string; mime_type?: string; error?: string; model?: string }>(
          `${fluxVideoUrl}/generate-video`,
          {
            image: imageUrl,
            prompt,
            duration_sec: effectiveDuration,
            fps: 25,
            style: motionStyle,
          },
          {
            headers: { "Content-Type": "application/json" },
            timeout: getVideoGenerationTimeoutMs(),
            responseType: "text",
          }
        );
        const parsed: { video?: string; image?: string; mime_type?: string; error?: string; model?: string } =
          typeof res.data === "string" ? JSON.parse(res.data.trim()) : res.data;
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        if (parsed && (parsed.video || parsed.image)) {
          const videoBase64 = parsed.video || parsed.image!;
          const mimeType = parsed.mime_type || "video/mp4";
          const secureUrl = await uploadVideoToCloudinary(
            videoBase64.startsWith("data:") ? videoBase64 : `data:${mimeType};base64,${videoBase64}`
          );
          return {
            videoUrl: secureUrl,
            duration: effectiveDuration,
            mimeType: "video/mp4",
            model: parsed.model || "Stable Video Diffusion (FLUX GPU)",
            tier: "ai-video",
          };
        }
        lastError = "GPU video endpoint returned no video data";
      } catch (gpuErr: unknown) {
        const err = gpuErr as Error;
        lastError = err.message || "FLUX GPU video endpoint failed";
        logger.error({ err: lastError }, "FLUX GPU video endpoint failed");
      }
    }

    throw new Error(
      `FLUX / SVD video generation failed: ${lastError}. Please try again or switch to another AI model.`
    );
  }

  // 1. FIRST: Use gemini-omni-1.2-flash as instructed by the user
  if (process.env.GEMINI_API_KEY) {
    try {
      return await generateVideoWithGeminiOmni(options);
    } catch (geminiErr: unknown) {
      const err = geminiErr as Error;
      logger.warn(
        { err: err.message },
        "gemini-omni-1.2-flash video generation failed, falling back to SVD"
      );
    }
  }

  // 2. SECOND: ComfyUI SVD XT 1.1 (3-4s video diffusion directly from image)
  if (getComfyApiUrl()) {
    try {
      logger.info(
        { model: "svd_xt_1_1" },
        "Routing video generation to ComfyUI SVD XT 1.1 fallback"
      );
      return await generateVideoWithComfy(options);
    } catch (svdErr: unknown) {
      const err = svdErr as Error;
      logger.warn(
        { err: err.message },
        "ComfyUI SVD video generation failed, falling back to secondary providers"
      );
    }
  }

  // 3. THIRD: If custom Colab GPU server / video tunnel is active, route to it
  const fluxApiUrl = (process.env.VIDEO_API_URL || process.env.FLUX_API_URL)?.trim();
  if (fluxApiUrl) {
    try {
      logger.info({ url: fluxApiUrl, duration: effectiveDuration }, "Dispatching video generation to GPU Model Server");

      const prompt = buildVideoPrompt({
        duration: effectiveDuration,
        motionStyle,
        occasion,
      });

      const executeVideoColabRequest = async () => {
        return axios.post<string | { video?: string; image?: string; mime_type?: string; error?: string; model?: string }>(
          `${fluxApiUrl}/generate-video`,
          {
            image: imageUrl,
            prompt,
            duration_sec: effectiveDuration,
            fps: 25,
            style: motionStyle,
          },
          {
            headers: { "Content-Type": "application/json" },
            timeout: getVideoGenerationTimeoutMs(),
            responseType: "text",
          }
        );
      };

      let res;
      try {
        res = await executeVideoColabRequest();
      } catch (err: unknown) {
        const axiosErr = err as { response?: { status?: number; data?: unknown }; message?: string };
        const isGpuBusy =
          axiosErr.response?.status === 503 ||
          (typeof axiosErr.response?.data === "string" && axiosErr.response.data.includes("gpu_busy")) ||
          (typeof axiosErr.response?.data === "object" && (axiosErr.response?.data as { error?: string })?.error === "gpu_busy") ||
          (axiosErr.message && axiosErr.message.includes("gpu_busy"));

        if (isGpuBusy) {
          const retryDelay = process.env.GPU_RETRY_DELAY_MS ? parseInt(process.env.GPU_RETRY_DELAY_MS, 10) : 20000;
          logger.warn({ retryDelay }, "Colab SVD GPU returned 503 gpu_busy. Waiting before retrying once...");
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          res = await executeVideoColabRequest();
        } else {
          throw err;
        }
      }

      let rawData = res.data;
      let parsed: { video?: string; image?: string; mime_type?: string; error?: string; model?: string } =
        typeof rawData === "string" ? JSON.parse(rawData.trim()) : rawData;

      if (parsed.error === "gpu_busy") {
        const retryDelay = process.env.GPU_RETRY_DELAY_MS ? parseInt(process.env.GPU_RETRY_DELAY_MS, 10) : 20000;
        logger.warn({ retryDelay }, "Colab SVD GPU reported gpu_busy in payload. Waiting before retrying once...");
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        res = await executeVideoColabRequest();
        rawData = res.data;
        parsed = typeof rawData === "string" ? JSON.parse(rawData.trim()) : rawData;
      }

      if (parsed.error) {
        throw new Error(parsed.error);
      }

      if (parsed && (parsed.video || parsed.image)) {
        const videoBase64 = parsed.video || parsed.image!;
        const mimeType = parsed.mime_type || "video/mp4";
        logger.info("Successfully generated video from GPU Video Diffusion model. Uploading to Cloudinary CDN...");

        const secureUrl = await uploadVideoToCloudinary(
          videoBase64.startsWith("data:") ? videoBase64 : `data:${mimeType};base64,${videoBase64}`
        );

        return {
          videoUrl: secureUrl,
          duration: effectiveDuration,
          mimeType: "video/mp4",
          model: parsed.model || "Stable Video Diffusion (Colab L4 GPU)",
          tier: "ai-video",
        };
      }
    } catch (apiErr: unknown) {
      const err = apiErr as { response?: { status?: number; data?: unknown }; message?: string };
      logger.warn(
        { status: err.response?.status, err: err.message },
        "GPU Video model endpoint unavailable; falling back to Neural Motion Engine"
      );
    }
  }

  // 3. THIRD: Cloudinary Neural Motion Engine (Ensures 100% reliable 1080p MP4 delivery)
  logger.info({ duration: effectiveDuration }, "Generating video via Neural Motion Engine");

  let cdnImageUrl = imageUrl;
  if (imageUrl.startsWith("data:image/")) {
    cdnImageUrl = await uploadToCloudinary(imageUrl);
  }

  let videoUrl = generateDynamicMotionVideoUrl(cdnImageUrl, effectiveDuration);
  if (!videoUrl) {
    const uploadedVid = await uploadVideoToCloudinary(cdnImageUrl);
    videoUrl = uploadedVid;
  }

  return {
    videoUrl,
    duration: effectiveDuration,
    mimeType: "video/mp4",
    model: "Neural Dynamic Motion Engine (Cloudinary)",
    tier: "animated-card",
  };
}
