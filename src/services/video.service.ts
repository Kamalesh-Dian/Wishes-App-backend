import dotenv from "dotenv";
import axios from "axios";
import { uploadToCloudinary, uploadVideoToCloudinary, generateDynamicMotionVideoUrl } from "./cloudinary.service";
import { buildFluxPrompt } from "./promptBuilder";
import { generateVideoWithComfy, getComfyApiUrl } from "./comfy.service";
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

  // Build comprehensive prompt matching image generation context and facial likeness
  const scenePrompt =
    customPrompt.trim() ||
    buildFluxPrompt({
      occasion,
      theme,
      decorations,
      people,
      customMessage,
      additionalInformation,
    });

  const prompt = `Generate a ${effectiveDuration}-second photorealistic cinematic celebration video animating this image. Maintain the exact same person, face, identity, and facial likeness from the reference image. Visual scene details: ${scenePrompt}. Motion style: ${motionStyle}. Camera dynamics: smooth natural motion, festive particle drifts, cinematic lighting and celebration ambiance.`;

  logger.info(
    { model: "gemini-omni-1.2-flash", occasion, duration: effectiveDuration, promptLength: prompt.length },
    "Dispatching image-to-video generation to gemini-omni-1.2-flash with full scene prompt"
  );

  const { base64, mimeType } = await getImageBase64(imageUrl);

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKey}`,
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
      headers: { "Content-Type": "application/json" },
      timeout: 180000, // 3 minutes timeout for video synthesis
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
  const isSvdRequested = options.aiEngine === "svd" || options.aiEngine === "comfy";

  // 0. DIRECT SVD OVERRIDE: If caller explicitly requests SVD, dispatch directly to ComfyUI
  if (isSvdRequested && getComfyApiUrl()) {
    try {
      logger.info({ model: "svd_xt_1_1" }, "Direct SVD XT 1.1 requested; routing to ComfyUI");
      return await generateVideoWithComfy(options);
    } catch (svdErr: unknown) {
      const err = svdErr as Error;
      logger.warn(
        { err: err.message },
        "ComfyUI SVD direct execution failed, falling back to Gemini Omni"
      );
    }
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

      const prompt = `Cinematic ${occasion} celebration, ${theme ? `theme: ${theme}, ` : ""}${customMessage ? `message: ${customMessage}, ` : ""}festive lighting, smooth 3D camera pan, particles floating in air`;

      const res = await axios.post<string | { video?: string; image?: string; mime_type?: string; error?: string }>(
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
          timeout: 300000,
          responseType: "text",
        }
      );

      const rawData = res.data;
      const parsed: { video?: string; image?: string; mime_type?: string; error?: string; model?: string } =
        typeof rawData === "string" ? JSON.parse(rawData.trim()) : rawData;

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
  };
}
