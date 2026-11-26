import { describe, it, expect, afterEach } from "vitest";
import {
  getVideoGenerationTimeoutMs,
  getImageGenerationTimeoutMs,
  getCloudinaryUploadTimeoutMs,
  getComfyPollIntervalMs,
} from "../config/timeouts";

describe("Configurable Generation Timeouts", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults video generation timeout to 6 minutes (360000 ms)", () => {
    delete process.env.VIDEO_GENERATION_TIMEOUT_MS;
    delete process.env.IMAGE_GENERATION_TIMEOUT_MS;
    delete process.env.CLOUDINARY_UPLOAD_TIMEOUT_MS;
    delete process.env.COMFY_POLL_INTERVAL_MS;

    expect(getVideoGenerationTimeoutMs()).toBe(360_000);
    expect(getImageGenerationTimeoutMs()).toBe(240_000);
    expect(getCloudinaryUploadTimeoutMs()).toBe(180_000);
    expect(getComfyPollIntervalMs()).toBe(2_000);
  });

  it("reads custom timeout overrides from environment config", () => {
    process.env.VIDEO_GENERATION_TIMEOUT_MS = "480000";
    process.env.IMAGE_GENERATION_TIMEOUT_MS = "300000";
    process.env.CLOUDINARY_UPLOAD_TIMEOUT_MS = "120000";
    process.env.COMFY_POLL_INTERVAL_MS = "3000";

    expect(getVideoGenerationTimeoutMs()).toBe(480_000);
    expect(getImageGenerationTimeoutMs()).toBe(300_000);
    expect(getCloudinaryUploadTimeoutMs()).toBe(120_000);
    expect(getComfyPollIntervalMs()).toBe(3_000);
  });

  it("falls back to safe defaults when env values are invalid", () => {
    process.env.VIDEO_GENERATION_TIMEOUT_MS = "invalid";
    process.env.IMAGE_GENERATION_TIMEOUT_MS = "-50";

    expect(getVideoGenerationTimeoutMs()).toBe(360_000);
    expect(getImageGenerationTimeoutMs()).toBe(240_000);
  });
});
