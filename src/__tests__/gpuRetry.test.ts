import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { generateWithFlux } from "../services/providers/flux.service";
import { generateVideoWithModel } from "../services/video.service";
import * as cloudinaryService from "../services/cloudinary.service";

describe("Task 7: GPU Memory 503 Retry Handling", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = {
      ...originalEnv,
      FLUX_API_URL: "https://mock-gpu-colab.trycloudflare.com",
      GPU_RETRY_DELAY_MS: "10", // fast retry for testing
    };
    // Ensure ComfyUI and Gemini do not intercept in this test
    delete process.env.COMFY_API_URL;
    delete process.env.COMFYUI_API_URL;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("retries FLUX generation once after a 503 gpu_busy error and succeeds", async () => {
    let callCount = 0;
    vi.spyOn(axios, "post").mockImplementation(async (url: string) => {
      if (url.includes("/generate")) {
        callCount++;
        if (callCount === 1) {
          const err: any = new Error("Request failed with status code 503");
          err.response = {
            status: 503,
            data: { error: "gpu_busy" },
          };
          throw err;
        }
        return {
          status: 200,
          data: JSON.stringify({ image: "base64GeneratedImageData", mime_type: "image/png" }),
        } as any;
      }
      return { data: {} } as any;
    });

    const result = await generateWithFlux("Festive celebration photo", "data:image/png;base64,sample");
    expect(callCount).toBe(2);
    expect(result.provider).toBe("flux-colab");
    expect(result.base64).toBe("base64GeneratedImageData");
  });

  it("retries SVD video generation once after a 503 gpu_busy error and succeeds", async () => {
    vi.spyOn(cloudinaryService, "uploadVideoToCloudinary").mockResolvedValue("https://cdn.cloudinary.com/test_video.mp4");

    let callCount = 0;
    vi.spyOn(axios, "post").mockImplementation(async (url: string) => {
      if (url.includes("/generate-video")) {
        callCount++;
        if (callCount === 1) {
          const err: any = new Error("Request failed with status code 503");
          err.response = {
            status: 503,
            data: { error: "gpu_busy" },
          };
          throw err;
        }
        return {
          status: 200,
          data: JSON.stringify({
            video: "base64VideoData",
            mime_type: "video/mp4",
            model: "Stable Video Diffusion (Colab T4 GPU)",
          }),
        } as any;
      }
      return { data: {} } as any;
    });

    const result = await generateVideoWithModel({
      imageUrl: "https://example.com/clean.png",
      occasion: "Birthday",
    });

    expect(callCount).toBe(2);
    expect(result.tier).toBe("ai-video");
    expect(result.videoUrl).toBe("https://cdn.cloudinary.com/test_video.mp4");
  });

  it("falls back gracefully when 503 persists after retry in SVD", async () => {
    vi.spyOn(cloudinaryService, "uploadToCloudinary").mockResolvedValue("https://cdn.cloudinary.com/img.png");
    vi.spyOn(cloudinaryService, "generateDynamicMotionVideoUrl").mockReturnValue("https://cdn.cloudinary.com/animated.mp4");

    let callCount = 0;
    vi.spyOn(axios, "post").mockImplementation(async (url: string) => {
      if (url.includes("/generate-video")) {
        callCount++;
        const err: any = new Error("Request failed with status code 503");
        err.response = {
          status: 503,
          data: { error: "gpu_busy" },
        };
        throw err;
      }
      return { data: {} } as any;
    });

    const result = await generateVideoWithModel({
      imageUrl: "https://example.com/clean.png",
      occasion: "Birthday",
    });

    expect(callCount).toBe(2); // Initial attempt + 1 retry
    expect(result.tier).toBe("animated-card");
    expect(result.model).toContain("Cloudinary");
  });

  it("retries ComfyUI prompt submission once if ComfyUI returns 503 gpu_busy", async () => {
    process.env.COMFY_API_URL = "https://mock-comfy.trycloudflare.com";

    let promptCalls = 0;
    vi.spyOn(axios, "post").mockImplementation(async (url: string) => {
      if (url.includes("/prompt")) {
        promptCalls++;
        if (promptCalls === 1) {
          const err: any = new Error("Request failed with status code 503");
          err.response = { status: 503, data: { error: "gpu_busy" } };
          throw err;
        }
        return { data: { prompt_id: "test-prompt-123" } } as any;
      }
      return { data: {} } as any;
    });

    vi.spyOn(axios, "get").mockImplementation(async (url: string) => {
      if (url.includes("/history/test-prompt-123")) {
        return {
          data: {
            "test-prompt-123": {
              status: { completed: true },
              outputs: {
                "10": {
                  images: [{ filename: "out.png", subfolder: "", type: "output" }],
                },
              },
            },
          },
        } as any;
      }
      if (url.includes("/view")) {
        return { data: Buffer.from("fake-image-bytes") } as any;
      }
      return { data: {} } as any;
    });

    const res = await generateWithFlux("A festive image");
    expect(promptCalls).toBe(2);
    expect(res.provider).toBe("flux-comfy");
  });
});
