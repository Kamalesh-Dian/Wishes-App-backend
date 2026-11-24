import axios from "axios";
import sharp from "sharp";
import { logger } from "../utils/logger";
import { uploadVideoToCloudinary } from "./cloudinary.service";
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
 * Polls ComfyUI /history/{prompt_id} until execution is complete
 */
async function waitForComfyOutput(
  promptId: string,
  timeoutMs = 180000
): Promise<{ filename: string; subfolder: string; type: string }> {
  const comfyUrl = getComfyApiUrl();
  if (!comfyUrl) throw new Error("COMFY_API_URL is not set");

  const startTime = Date.now();
  logger.info({ promptId }, "Waiting for ComfyUI execution output...");

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));

    try {
      const res = await axios.get<ComfyHistoryResponse>(`${comfyUrl}/history/${promptId}`, {
        timeout: 10000,
      });

      const historyData = res.data?.[promptId];
      if (historyData) {
        // Fast fail: if ComfyUI errored on any node, immediately throw instead of hanging for 5 mins
        if (historyData.status?.status_str === "error") {
          const errMessage =
            historyData.status?.messages?.find((m) => m[0] === "execution_error")?.[1]
              ?.exception_message || "ComfyUI execution failed";
          throw new Error(`ComfyUI error: ${errMessage}`);
        }

        if (historyData.outputs) {
          for (const nodeId of Object.keys(historyData.outputs)) {
            const out = historyData.outputs[nodeId];
            const fileInfo = out.images?.[0];
            if (fileInfo && typeof fileInfo === "object" && fileInfo.filename) {
              logger.info({ promptId, fileInfo }, "ComfyUI generation completed successfully");
              return fileInfo;
            }
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
        text: "blurry, out of focus, distorted face, plastic skin, low quality artifacts",
      },
    },
  };

  let latentRef: [string, number];
  let denoise = 1.0;

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
    latentRef = ["7", 0];
    denoise = 0.8;
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
    denoise = 1.0;
  }

  promptGraph["8"] = {
    class_type: "KSampler",
    inputs: {
      model: ["11", 0],
      positive: ["4", 0],
      negative: ["5", 0],
      latent_image: latentRef,
      seed: Math.floor(Math.random() * 10000000),
      steps: 8,
      cfg: 1.0,
      sampler_name: "res_multistep",
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

  const queueRes = await axios.post<ComfyPromptResponse>(
    `${comfyUrl}/prompt`,
    {
      prompt: promptGraph,
      client_id: "wishes_ai_backend",
    },
    { timeout: 15000 }
  );

  const promptId = queueRes.data.prompt_id;
  const fileInfo = await waitForComfyOutput(promptId, 180000);
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

  // 1. Upload reference image to ComfyUI input folder
  const uploadedFileName = await uploadImageToComfy(
    imageUrl,
    `svd_init_${Date.now()}.png`
  );

  // 2. Build SVD XT Workflow Graph
  const promptGraph = {
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
        width: 512,
        height: 512,
        video_frames: 25,
        motion_bucket_id: 127,
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
        seed: Math.floor(Math.random() * 10000000),
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
    "6": {
      class_type: "SaveAnimatedWEBP",
      inputs: {
        images: ["5", 0],
        filename_prefix: "WishesAI_SVD",
        fps: 6,
        lossless: false,
        quality: 90,
        method: "default",
      },
    },
  };

  // 3. Queue prompt
  const queueRes = await axios.post<ComfyPromptResponse>(
    `${comfyUrl}/prompt`,
    {
      prompt: promptGraph,
      client_id: "wishes_ai_backend",
    },
    { timeout: 15000 }
  );

  const promptId = queueRes.data.prompt_id;
  const fileInfo = await waitForComfyOutput(promptId, 300000);
  const fileBuffer = await downloadComfyFile(fileInfo);

  // 4. Upload generated video/animation directly to Cloudinary CDN
  const base64Data = `data:image/webp;base64,${fileBuffer.toString("base64")}`;
  const secureUrl = await uploadVideoToCloudinary(base64Data);

  return {
    videoUrl: secureUrl,
    duration: effectiveDuration,
    mimeType: "video/mp4",
    model: "Stable Video Diffusion XT 1.1 (ComfyUI)",
  };
}
