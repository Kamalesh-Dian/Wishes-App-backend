function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Video generation timeout in milliseconds.
 * Configurable via VIDEO_GENERATION_TIMEOUT_MS in backend/.env.
 * Default: 360000 ms (6 minutes).
 */
export function getVideoGenerationTimeoutMs(): number {
  return parsePositiveInt(process.env.VIDEO_GENERATION_TIMEOUT_MS, 360_000);
}

/**
 * Image generation timeout in milliseconds.
 * Configurable via IMAGE_GENERATION_TIMEOUT_MS in backend/.env.
 * Default: 240000 ms (4 minutes).
 */
export function getImageGenerationTimeoutMs(): number {
  return parsePositiveInt(process.env.IMAGE_GENERATION_TIMEOUT_MS, 240_000);
}

/**
 * Cloudinary media upload timeout in milliseconds.
 * Configurable via CLOUDINARY_UPLOAD_TIMEOUT_MS in backend/.env.
 * Default: 180000 ms (3 minutes).
 */
export function getCloudinaryUploadTimeoutMs(): number {
  return parsePositiveInt(process.env.CLOUDINARY_UPLOAD_TIMEOUT_MS, 180_000);
}

/**
 * ComfyUI history polling interval in milliseconds.
 * Configurable via COMFY_POLL_INTERVAL_MS in backend/.env.
 * Default: 2000 ms (2 seconds).
 */
export function getComfyPollIntervalMs(): number {
  return parsePositiveInt(process.env.COMFY_POLL_INTERVAL_MS, 2_000);
}
