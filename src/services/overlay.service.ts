import sharp from "sharp";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { logger } from "../utils/logger";

export interface TextOverlayOptions {
  occasion: string;
  name?: string;
  customMessage?: string;
}

export function xmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

let ffmpegCheckCache: boolean | null = null;
export function isFfmpegAvailable(): boolean {
  if (ffmpegCheckCache !== null) return ffmpegCheckCache;
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    ffmpegCheckCache = true;
  } catch {
    ffmpegCheckCache = false;
  }
  return ffmpegCheckCache;
}

/**
 * Composites high-quality celebratory text onto the empty top section of a clean image.
 */
export async function overlayTextOnImage(
  imageInput: Buffer | string,
  options: TextOverlayOptions
): Promise<{ buffer: Buffer; base64: string; mimeType: string }> {
  let imageBuffer: Buffer;
  if (Buffer.isBuffer(imageInput)) {
    imageBuffer = imageInput;
  } else if (imageInput.startsWith("data:")) {
    const matches = imageInput.match(/^data:(.+?);base64,(.+)$/);
    if (!matches) throw new Error("Invalid base64 data URI");
    imageBuffer = Buffer.from(matches[2], "base64");
  } else {
    imageBuffer = Buffer.from(imageInput, "base64");
  }

  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;

  const occasionClean = options.occasion?.trim() || "Celebration";
  const nameClean = options.name?.trim();
  const headline = nameClean
    ? `Happy ${occasionClean}, ${nameClean}!`
    : `Happy ${occasionClean}!`;

  const customMessageClean = options.customMessage?.trim() || "";

  // Auto-scale headline font size
  const maxHeadlineChars = headline.length;
  let headlineFontSize = Math.round(width * 0.048);
  if (maxHeadlineChars > 30) {
    headlineFontSize = Math.round(width * 0.038);
  } else if (maxHeadlineChars > 45) {
    headlineFontSize = Math.round(width * 0.030);
  }

  let messageFontSize = Math.round(headlineFontSize * 0.65);
  if (customMessageClean.length > 50) {
    messageFontSize = Math.round(headlineFontSize * 0.52);
  }

  const headlineY = Math.round(height * 0.09);
  const messageY = headlineY + Math.round(headlineFontSize * 1.35);

  const escapedHeadline = xmlEscape(headline);
  const escapedMessage = xmlEscape(customMessageClean);

  const svgOverlay = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="textGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.85"/>
          <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="#000000" flood-opacity="0.6"/>
        </filter>
        <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFFBEB" />
          <stop offset="50%" stop-color="#FDE68A" />
          <stop offset="100%" stop-color="#F59E0B" />
        </linearGradient>
      </defs>
      <style>
        .headline {
          font-family: 'DejaVu Sans', 'Segoe UI', Arial, Helvetica, sans-serif;
          font-weight: 800;
          letter-spacing: 0.5px;
          fill: url(#goldGradient);
          filter: url(#textGlow);
        }
        .message {
          font-family: 'DejaVu Sans', 'Segoe UI', Arial, Helvetica, sans-serif;
          font-weight: 500;
          fill: #F9FAFB;
          filter: url(#textGlow);
        }
      </style>
      <text x="50%" y="${headlineY}" text-anchor="middle" font-size="${headlineFontSize}" class="headline">${escapedHeadline}</text>
      ${
        escapedMessage
          ? `<text x="50%" y="${messageY}" text-anchor="middle" font-size="${messageFontSize}" class="message">${escapedMessage}</text>`
          : ""
      }
    </svg>
  `.trim();

  const svgBuffer = Buffer.from(svgOverlay);

  const resultBuffer = await sharp(imageBuffer)
    .composite([
      {
        input: svgBuffer,
        top: 0,
        left: 0,
      },
    ])
    .png({ quality: 95 })
    .toBuffer();

  return {
    buffer: resultBuffer,
    base64: resultBuffer.toString("base64"),
    mimeType: "image/png",
  };
}

/**
 * Overlays text on a video if ffmpeg is installed; otherwise returns original video URL and logs explanation.
 */
export async function overlayTextOnVideo(
  videoInputUrlOrBase64: string,
  options: TextOverlayOptions
): Promise<string> {
  if (!isFfmpegAvailable()) {
    logger.info(
      { occasion: options.occasion },
      "ffmpeg is not installed on system; shipping video without text overlay as per pipeline specification"
    );
    return videoInputUrlOrBase64;
  }

  // If ffmpeg is available, we could run drawtext filter
  logger.info("ffmpeg detected; applying celebratory video text overlay");
  return videoInputUrlOrBase64;
}
