import fs from "fs";
import path from "path";
import os from "os";
import cloudinary from "../config/cloudinary";
import { logger } from "../utils/logger";

export async function uploadToCloudinary(imageBase64: string): Promise<string> {
  const result = await cloudinary.uploader.upload(imageBase64, {
    folder: "wishes-ai",
  });

  return result.secure_url;
}

export async function uploadVideoToCloudinary(videoInput: string): Promise<string> {
  const isBase64 = videoInput.startsWith("data:") || !videoInput.startsWith("http");

  if (isBase64) {
    const base64Data = videoInput.includes(",") ? videoInput.split(",")[1] : videoInput;
    const buffer = Buffer.from(base64Data, "base64");
    const tempFile = path.join(
      os.tmpdir(),
      `wishes_vid_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`
    );

    try {
      await fs.promises.writeFile(tempFile, buffer);
      logger.info({ sizeBytes: buffer.length }, "Uploading temp video file to Cloudinary");

      const result = await cloudinary.uploader.upload(tempFile, {
        folder: "wishes-ai/videos",
        resource_type: "video",
      });

      return result.secure_url;
    } finally {
      await fs.promises.unlink(tempFile).catch(() => {});
    }
  }

  // Remote URL or direct path
  const result = await cloudinary.uploader.upload(videoInput, {
    folder: "wishes-ai/videos",
    resource_type: "video",
  });

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
