import fs from "fs";
import path from "path";
import os from "os";
import cloudinary from "../config/cloudinary";
import { getCloudinaryUploadTimeoutMs } from "../config/timeouts";
import { logger } from "../utils/logger";

export async function uploadToCloudinary(imageInput: string): Promise<string> {
  const isBase64 = imageInput.startsWith("data:") || !imageInput.startsWith("http");

  if (isBase64) {
    const base64Data = imageInput.includes(",") ? imageInput.split(",")[1] : imageInput;
    const buffer = Buffer.from(base64Data, "base64");
    const tempFile = path.join(
      os.tmpdir(),
      `wishes_img_${Date.now()}_${Math.random().toString(36).substring(7)}.png`
    );

    try {
      await fs.promises.writeFile(tempFile, buffer);
      logger.info({ sizeBytes: buffer.length }, "Uploading image file to Cloudinary");

      const result = await cloudinary.uploader.upload(tempFile, {
        folder: "wishes-ai",
        resource_type: "image",
        timeout: getCloudinaryUploadTimeoutMs(), // 3 minutes timeout
      });

      return result.secure_url;
    } finally {
      await fs.promises.unlink(tempFile).catch(() => {});
    }
  }

  const result = await cloudinary.uploader.upload(imageInput, {
    folder: "wishes-ai",
    resource_type: "image",
    timeout: 180000,
  });

  return result.secure_url;
}

export async function uploadVideoToCloudinary(
  videoInput: string,
  options?: { boomerang?: boolean }
): Promise<string> {
  const isBase64 = videoInput.startsWith("data:") || !videoInput.startsWith("http");
  const useBoomerang = Boolean(options?.boomerang);

  if (isBase64) {
    const isAnimatedWebp = videoInput.startsWith("data:image/webp");
    const base64Data = videoInput.includes(",") ? videoInput.split(",")[1] : videoInput;
    const buffer = Buffer.from(base64Data, "base64");
    const ext = isAnimatedWebp ? "webp" : "mp4";
    const tempFile = path.join(
      os.tmpdir(),
      `wishes_vid_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`
    );

    try {
      await fs.promises.writeFile(tempFile, buffer);

      if (isAnimatedWebp) {
        logger.info({ sizeBytes: buffer.length, useBoomerang }, "Uploading animated WebP to Cloudinary for MP4 transcoding");
        const result = await cloudinary.uploader.upload(tempFile, {
          folder: "wishes-ai/videos",
          resource_type: "image",
          timeout: getCloudinaryUploadTimeoutMs(),
        });
        const transforms: Record<string, unknown>[] = [{ video_codec: "h264" }];
        if (useBoomerang) transforms.unshift({ effect: "boomerang" });
        return cloudinary.url(result.public_id, {
          resource_type: "image",
          format: "mp4",
          secure: true,
          transformation: transforms,
        });
      }

      logger.info({ sizeBytes: buffer.length, useBoomerang }, "Uploading temp MP4 video file to Cloudinary");
      const result = await cloudinary.uploader.upload(tempFile, {
        folder: "wishes-ai/videos",
        resource_type: "video",
        format: "mp4",
        timeout: getCloudinaryUploadTimeoutMs(),
      });

      if (useBoomerang) {
        return cloudinary.url(result.public_id, {
          resource_type: "video",
          format: "mp4",
          secure: true,
          transformation: [{ effect: "boomerang" }, { video_codec: "h264" }],
        });
      }

      return result.secure_url;
    } finally {
      await fs.promises.unlink(tempFile).catch(() => {});
    }
  }

  // Remote URL or direct path
  const result = await cloudinary.uploader.upload(videoInput, {
    folder: "wishes-ai/videos",
    resource_type: "video",
    format: "mp4",
    timeout: 180000,
  });

  if (useBoomerang) {
    return cloudinary.url(result.public_id, {
      resource_type: "video",
      format: "mp4",
      secure: true,
      transformation: [{ effect: "boomerang" }, { video_codec: "h264" }],
    });
  }

  return result.secure_url;
}

export function generateDynamicMotionVideoUrl(imageUrl: string, durationSec: number = 10): string {
  // Extract Cloudinary public ID if it's already a Cloudinary image
  const cloudMatch = imageUrl.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/);
  if (cloudMatch && cloudMatch[1]) {
    const publicId = cloudMatch[1];
    return cloudinary.url(publicId, {
      resource_type: "video",
      format: "mp4",
      transformation: [
        { effect: `zoompan:mode_in;maxzoom_1.15;du_${Math.min(10, Math.max(4, durationSec))};fps_30` },
      ],
    });
  }

  // If not Cloudinary, return the original or empty
  return "";
}
