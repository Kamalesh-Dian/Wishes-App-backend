import axios from "axios";
import sharp from "sharp";
import { logger } from "../utils/logger";
import { uploadVideoToCloudinary } from "./cloudinary.service";
import { NEGATIVE_PROMPT } from "./promptBuilder";
import {
  getImageGenerationTimeoutMs,
  getVideoGenerationTimeoutMs,
  getComfyPollIntervalMs,
} from "../config/timeouts";
import type { GenerateVideoModelOptions, VideoModelResult } from "./video.service";

interface ComfyUploadResponse {
  name: string;
  subfolder: string;
  type: string;
}

interface ComfyPromptResponse {
  prompt_id: string;
  number: number;
  node_errors?: Record<string, unknown>;
}

interface ComfyHistoryOutput {
  images?: Array<{
    filename: string;
    subfolder: string;
    type: string;
  }>;
  animated?: Array<{
    filename: string;
    subfolder: string;
    type: string;
  }>;
}

interface ComfyHistoryResponse {
  [prompt_id: string]: {
    status?: {
      status_str: string;
      completed: boolean;
      messages?: Array<[string, { exception_message?: string; [key: string]: unknown }]>;
    };
    outputs: {
      [node_id: string]: ComfyHistoryOutput;
    };
  };
}

export function getComfyApiUrl(): string | null {
  const url = process.env.COMFY_API_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

export async function isComfyUIAvailable(): Promise<boolean> {
  const url = getComfyApiUrl();
  if (!url) return false;
  try {
    const res = await axios.get(`${url}/system_stats`, { timeout: 8000 });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function hasComfyNode(comfyUrl: string, nodeName: string): Promise<boolean> {
  try {
    const res = await axios.get<Record<string, unknown>>(`${comfyUrl}/object_info/${nodeName}`, {
      timeout: 5000,
    });
    return Boolean(res.status === 200 && res.data && Object.prototype.hasOwnProperty.call(res.data, nodeName));
  } catch {
    return false;
  }
}

/**
 * Uploads an image buffer or base64 to ComfyUI input directory
 */
export async function uploadImageToComfy(
  imageInput: string | Buffer,
  filename = `input_${Date.now()}.png`
): Promise<string> {
  const comfyUrl = getComfyApiUrl();
  if (!comfyUrl) throw new Error("COMFY_API_URL is not set");

  let buffer: Buffer;
  let mimeType = "image/png";

  if (Buffer.isBuffer(imageInput)) {
    buffer = imageInput;
  } else if (imageInput.startsWith("data:")) {
    const matches = imageInput.match(/^data:(.+?);base64,(.+)$/);
    if (!matches) throw new Error("Invalid base64 image data");
    mimeType = matches[1];
    buffer = Buffer.from(matches[2], "base64");
  } else if (imageInput.startsWith("http://") || imageInput.startsWith("https://")) {
    const res = await axios.get(imageInput, { responseType: "arraybuffer", timeout: 20000 });
    buffer = Buffer.from(res.data);
    mimeType = (res.headers["content-type"] as string) || "image/png";
  } else {
    buffer = Buffer.from(imageInput, "base64");
  }

  // Pre-process & resize to max 1024x1024 to prevent GPU VAE overload and 3-minute slowdowns
  try {
    buffer = await sharp(buffer)
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .png({ quality: 95 })
      .toBuffer();
    mimeType = "image/png";
  } catch (resizeErr) {
    logger.debug({ err: resizeErr }, "Pre-upload image resize skipped, using raw buffer");
  }

  const formData = new FormData();
  formData.append("image", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
  formData.append("overwrite", "true");

  const res = await axios.post<ComfyUploadResponse>(`${comfyUrl}/upload/image`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 30000,
  });

  return res.data.name;
}

/**
 * Polls ComfyUI /history/{prompt_id} until execution is complete.
 * Inspects all output node arrays (images, gifs, animated, videos) and returns matching output file.
 */
async function waitForComfyOutput(
  promptId: string,
  timeoutMs = 180000,
  isVideoWorkflow = false
): Promise<{ filename: string; subfolder: string; type: string }> {
  const comfyUrl = getComfyApiUrl();
  if (!comfyUrl) throw new Error("COMFY_API_URL is not set");

  const startTime = Date.now();
  logger.info({ promptId, isVideoWorkflow }, "Waiting for ComfyUI execution output...");

  const videoExtensions = new Set([".mp4", ".webp", ".gif", ".webm", ".mov", ".avi", ".mkv"]);

  const pollIntervalMs = getComfyPollIntervalMs();

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    try {
      const res = await axios.get<ComfyHistoryResponse>(`${comfyUrl}/history/${promptId}`, {
        timeout: 10000,
      });

      const historyData = res.data?.[promptId];
      if (historyData) {
        if (historyData.status?.status_str === "error") {
          const errMessage =
            historyData.status?.messages?.find((m) => m[0] === "execution_error")?.[1]
              ?.exception_message || "ComfyUI execution failed";
          throw new Error(`ComfyUI error: ${errMessage}`);
        }

        if (historyData.outputs) {
          let firstFallbackFile: { filename: string; subfolder: string; type: string } | null = null;

          for (const nodeId of Object.keys(historyData.outputs)) {
            const out = historyData.outputs[nodeId] as Record<string, unknown>;
            if (!out) continue;

            for (const key of Object.keys(out)) {
              const val = out[key];
              if (Array.isArray(val)) {
                for (const item of val) {
                  if (item && typeof item === "object" && typeof item.filename === "string") {
                    const ext = ("." + item.filename.split(".").pop()).toLowerCase();
                    const isVideoExt = videoExtensions.has(ext);

                    if (isVideoWorkflow) {
                      if (isVideoExt) {
                        logger.info({ promptId, key, fileInfo: item }, "ComfyUI video/animated output detected");
                        return item;
                      }
                    } else if (!firstFallbackFile) {
                      firstFallbackFile = item;
                    }
                  }
                }
              }
            }
          }

          if (firstFallbackFile) {
            logger.info({ promptId, fileInfo: firstFallbackFile }, "ComfyUI output file found");
            return firstFallbackFile;
          }
        }
      }
    } catch (pollErr: unknown) {
      if ((pollErr as Error).message.includes("ComfyUI error:")) {
        throw pollErr;
      }
      logger.debug({ err: (pollErr as Error).message }, "ComfyUI polling heartbeat");
    }
  }

  throw new Error(`ComfyUI generation timed out after ${timeoutMs / 1000} seconds`);
}

/**
 * Downloads generated file from ComfyUI /view
 */
async function downloadComfyFile(
  fileInfo: { filename: string; subfolder: string; type: string }
): Promise<Buffer> {
  const comfyUrl = getComfyApiUrl();
  if (!comfyUrl) throw new Error("COMFY_API_URL is not set");

  const params = new URLSearchParams({
    filename: fileInfo.filename,
    subfolder: fileInfo.subfolder || "",
    type: fileInfo.type || "output",
  });

  const res = await axios.get(`${comfyUrl}/view?${params.toString()}`, {
    responseType: "arraybuffer",
    timeout: 60000,
  });

  return Buffer.from(res.data);
}

async function postPromptWithRetry(
  comfyUrl: string,
  payload: { prompt: Record<string, unknown>; client_id: string }
): Promise<ComfyPromptResponse> {
  try {
    const res = await axios.post<ComfyPromptResponse>(`${comfyUrl}/prompt`, payload, { timeout: 15000 });
    return res.data;
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status?: number; data?: unknown }; message?: string };
    const isGpuBusy =
      axiosErr.response?.status === 503 ||
      (typeof axiosErr.response?.data === "string" && axiosErr.response.data.includes("gpu_busy")) ||
      (typeof axiosErr.response?.data === "object" && (axiosErr.response?.data as { error?: string })?.error === "gpu_busy");

    if (isGpuBusy) {
      const retryDelay = process.env.GPU_RETRY_DELAY_MS ? parseInt(process.env.GPU_RETRY_DELAY_MS, 10) : 20000;
      logger.warn({ retryDelay }, "ComfyUI returned 503 gpu_busy. Waiting before retrying prompt submission once...");
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      const retryRes = await axios.post<ComfyPromptResponse>(`${comfyUrl}/prompt`, payload, { timeout: 15000 });
      return retryRes.data;
    }
    throw err;
  }
}

/**
 * 1. Image Generation via ComfyUI (FLUX-2 Klein / SD)
 */
export async function generateImageWithComfy(
  prompt: string,
  uploadedImageBase64?: string
): Promise<{ base64: string; mimeType: string }> {
  const comfyUrl = getComfyApiUrl();
  if (!comfyUrl) throw new Error("COMFY_API_URL not configured");

  logger.info({ prompt: prompt.slice(0, 80) }, "Starting ComfyUI FLUX image generation workflow");

  let uploadedFileName = "";
  if (uploadedImageBase64) {
    uploadedFileName = await uploadImageToComfy(uploadedImageBase64, `flux_init_${Date.now()}.png`);
  }

  const promptGraph: Record<string, unknown> = {
    "1": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "flux-2-klein-4b.safetensors",
        weight_dtype: "default",
      },
    },
    "11": {
      class_type: "ModelSamplingAuraFlow",
      inputs: {
        model: ["1", 0],
        shift: 3.0,
        sampling: "flow",
      },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen_3_4b.safetensors",
        type: "flux2",
        device: "default",
      },
    },
    "3": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "flux2-vae.safetensors",
      },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["2", 0],
        text: prompt,
      },
    },
    "5": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["2", 0],
        text: NEGATIVE_PROMPT,
      },
    },
  };

  let latentRef: [string, number];
  let positiveRef: [string, number] = ["4", 0];
  let negativeRef: [string, number] = ["5", 0];
  const denoise = 1.0;

  if (uploadedFileName) {
    promptGraph["6"] = {
      class_type: "LoadImage",
      inputs: {
        image: uploadedFileName,
      },
    };
    promptGraph["7"] = {
      class_type: "VAEEncode",
      inputs: {
        pixels: ["6", 0],
        vae: ["3", 0],
      },
    };
    // FLUX.2 Klein reference conditioning: preserves uploaded person's exact face/identity
    // while denoising from fresh noise (denoise: 1.0) so pose, outfit, and scene can change naturally.
    promptGraph["12"] = {
      class_type: "ReferenceLatent",
      inputs: {
        conditioning: ["4", 0],
        latent: ["7", 0],
      },
    };
    promptGraph["13"] = {
      class_type: "ReferenceLatent",
      inputs: {
        conditioning: ["5", 0],
        latent: ["7", 0],
      },
    };
    positiveRef = ["12", 0];
    negativeRef = ["13", 0];
    latentRef = ["7", 0];
  } else {
    promptGraph["6"] = {
      class_type: "EmptySD3LatentImage",
      inputs: {
        width: 1024,
        height: 1024,
        batch_size: 1,
      },
    };
    latentRef = ["6", 0];
  }

  promptGraph["8"] = {
    class_type: "KSampler",
    inputs: {
      model: ["11", 0],
      positive: positiveRef,
      negative: negativeRef,
      latent_image: latentRef,
      seed: Math.floor(Math.random() * 10000000),
      steps: 4,
      cfg: 1.0,
      sampler_name: "euler",
      scheduler: "simple",
      denoise,
    },
  };

  promptGraph["9"] = {
    class_type: "VAEDecode",
    inputs: {
      samples: ["8", 0],
      vae: ["3", 0],
    },
  };

  promptGraph["10"] = {
    class_type: "SaveImage",
    inputs: {
      images: ["9", 0],
      filename_prefix: "WishesAI_Flux",
    },
  };

  const promptData = await postPromptWithRetry(comfyUrl, {
    prompt: promptGraph,
    client_id: "wishes_ai_backend",
  });

  const promptId = promptData.prompt_id;
  const fileInfo = await waitForComfyOutput(promptId, getImageGenerationTimeoutMs());
  const fileBuffer = await downloadComfyFile(fileInfo);

  return {
    base64: fileBuffer.toString("base64"),
    mimeType: "image/png",
  };
}

/**
 * 2. Video Generation via ComfyUI (SVD Stable Video Diffusion svd_xt_1_1)
 */
export async function generateVideoWithComfy(
  options: GenerateVideoModelOptions
): Promise<VideoModelResult> {
  const comfyUrl = getComfyApiUrl();
  if (!comfyUrl) throw new Error("COMFY_API_URL not configured");

  const { imageUrl, duration = 8 } = options;
  const effectiveDuration = Math.min(8, Math.max(4, Math.round(duration)));

  logger.info({ effectiveDuration }, "Dispatching video generation to ComfyUI SVD XT 1.1");

  // 1. Inspect image dimensions and resize to 1024x576 (landscape) or 576x1024 (portrait)
  let imageBuffer: Buffer;
  if (imageUrl.startsWith("data:")) {
    const matches = imageUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!matches) throw new Error("Invalid base64 image data");
    imageBuffer = Buffer.from(matches[2], "base64");
  } else if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    const res = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 20000 });
    imageBuffer = Buffer.from(res.data);
  } else {
    imageBuffer = Buffer.from(imageUrl, "base64");
  }

  const meta = await sharp(imageBuffer).metadata();
  const isPortrait = (meta.height || 0) >= (meta.width || 0);
  const targetWidth = isPortrait ? 576 : 1024;
  const targetHeight = isPortrait ? 1024 : 576;

  const resizedBuffer = await sharp(imageBuffer)
    .resize(targetWidth, targetHeight, { fit: "cover" })
    .png()
    .toBuffer();

  const uploadedFileName = await uploadImageToComfy(
    resizedBuffer,
    `svd_init_${Date.now()}.png`
  );

  const envMotionBucket = parseInt(process.env.SVD_MOTION_BUCKET || "80", 10);
  const motionBucketId = isNaN(envMotionBucket)
    ? 80
    : Math.min(100, Math.max(60, envMotionBucket));

  // 2. Build SVD XT Workflow Graph (no text prompts; motion controlled via motion_bucket_id)
  const supportsSaveVideo =
    (await hasComfyNode(comfyUrl, "CreateVideo")) &&
    (await hasComfyNode(comfyUrl, "SaveVideo"));

  const promptGraph: Record<string, unknown> = {
    "1": {
      class_type: "ImageOnlyCheckpointLoader",
      inputs: {
        ckpt_name: "svd_xt_1_1.safetensors",
      },
    },
    "2": {
      class_type: "LoadImage",
      inputs: {
        image: uploadedFileName,
      },
    },
    "3": {
      class_type: "SVD_img2vid_Conditioning",
      inputs: {
        clip_vision: ["1", 1],
        init_image: ["2", 0],
        vae: ["1", 2],
        width: targetWidth,
        height: targetHeight,
        video_frames: 25,
        motion_bucket_id: motionBucketId,
        fps: 6,
        augmentation_level: 0.0,
      },
    },
    "4": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["3", 0],
        negative: ["3", 1],
        latent_image: ["3", 2],
        seed: 42,
        steps: 20,
        cfg: 2.5,
        sampler_name: "euler",
        scheduler: "karras",
        denoise: 1.0,
      },
    },
    "5": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["4", 0],
        vae: ["1", 2],
      },
    },
  };

  // Compute optimal FPS and seamless boomerang extension for 4s-8s while keeping SVD at 25 frames (zero face drift):
  // 4s -> 6 fps forward (~4.2s) | 5s -> 5 fps forward (5.0s)
  // 6s -> 8 fps boomerang (~6.25s) | 7s -> 7 fps boomerang (~7.1s) | 8s -> 6 fps boomerang (~8.3s)
  const useBoomerang = effectiveDuration >= 6;
  const outputFps =
    effectiveDuration === 4
      ? 6
      : effectiveDuration === 5
        ? 5
        : effectiveDuration === 6
          ? 8
          : effectiveDuration === 7
            ? 7
            : 6;

  if (supportsSaveVideo) {
    logger.info({ effectiveDuration, outputFps, useBoomerang }, "Using ComfyUI native CreateVideo + SaveVideo (H.264 MP4) output nodes");
    promptGraph["6"] = {
      class_type: "CreateVideo",
      inputs: {
        images: ["5", 0],
        fps: outputFps,
      },
    };
    promptGraph["7"] = {
      class_type: "SaveVideo",
      inputs: {
        video: ["6", 0],
        filename_prefix: "WishesAI_SVD",
        format: "mp4",
        codec: "h264",
      },
    };
  } else {
    logger.info({ effectiveDuration, outputFps, useBoomerang }, "ComfyUI SaveVideo node unavailable; using SaveAnimatedWEBP with Cloudinary MP4 transcoding");
    promptGraph["6"] = {
      class_type: "SaveAnimatedWEBP",
      inputs: {
        images: ["5", 0],
        filename_prefix: "WishesAI_SVD",
        fps: outputFps,
        lossless: false,
        quality: 90,
        method: "default",
      },
    };
  }

  // 3. Queue prompt
  const promptData = await postPromptWithRetry(comfyUrl, {
    prompt: promptGraph,
    client_id: "wishes_ai_backend",
  });

  const promptId = promptData.prompt_id;
  const fileInfo = await waitForComfyOutput(promptId, getVideoGenerationTimeoutMs(), true);
  const fileBuffer = await downloadComfyFile(fileInfo);

  // 4. Upload generated video directly to Cloudinary CDN as MP4 (with seamless boomerang for 6s-8s)
  const isMp4 = fileInfo.filename.toLowerCase().endsWith(".mp4");
  const base64Data = isMp4
    ? `data:video/mp4;base64,${fileBuffer.toString("base64")}`
    : `data:image/webp;base64,${fileBuffer.toString("base64")}`;
  const secureUrl = await uploadVideoToCloudinary(base64Data, { boomerang: useBoomerang });

  return {
    videoUrl: secureUrl,
    duration: effectiveDuration,
    mimeType: "video/mp4",
    model: "Stable Video Diffusion XT 1.1 (ComfyUI)",
    tier: "ai-video",
  };
}
