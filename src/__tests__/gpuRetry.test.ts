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

  it("retries ComfyUI SVD video prompt submission once after a 503 gpu_busy error and succeeds", async () => {
    process.env.COMFY_API_URL = "https://mock-comfy.trycloudflare.com";
    vi.spyOn(cloudinaryService, "uploadVideoToCloudinary").mockResolvedValue("https://cdn.cloudinary.com/test_video.mp4");

    let promptCalls = 0;
    vi.spyOn(axios, "post").mockImplementation(async (url: string) => {
      if (url.includes("/upload/image")) {
        return { data: { name: "svd_init.png", subfolder: "", type: "input" } } as any;
      }
      if (url.includes("/prompt")) {
        promptCalls++;
        if (promptCalls === 1) {
          const err: any = new Error("Request failed with status code 503");
          err.response = { status: 503, data: { error: "gpu_busy" } };
          throw err;
        }
        return { data: { prompt_id: "svd-retry-123" } } as any;
      }
      return { data: {} } as any;
    });

    vi.spyOn(axios, "get").mockImplementation(async (url: string) => {
      if (url.includes("/object_info/CreateVideo")) return { status: 200, data: { CreateVideo: {} } } as any;
      if (url.includes("/object_info/SaveVideo")) return { status: 200, data: { SaveVideo: {} } } as any;
      if (url.includes("/history/svd-retry-123")) {
        return {
          data: {
            "svd-retry-123": {
              status: { completed: true },
              outputs: { "7": { images: [{ filename: "out.mp4", subfolder: "", type: "output" }] } },
            },
          },
        } as any;
      }
      if (url.includes("/view")) return { data: Buffer.from("fake-mp4-bytes") } as any;
      return { data: {} } as any;
    });

    const tinyPngDataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const result = await generateVideoWithModel({
      imageUrl: tinyPngDataUri,
      occasion: "Birthday",
      aiEngine: "svd",
    });

    expect(promptCalls).toBe(2);
    expect(result.tier).toBe("ai-video");
    expect(result.videoUrl).toBe("https://cdn.cloudinary.com/test_video.mp4");
  });

  it("throws a clear error without falling back when ComfyUI SVD 503 persists after retry", async () => {
    process.env.COMFY_API_URL = "https://mock-comfy.trycloudflare.com";

    let promptCalls = 0;
    vi.spyOn(axios, "post").mockImplementation(async (url: string) => {
      if (url.includes("/upload/image")) {
        return { data: { name: "svd_init.png", subfolder: "", type: "input" } } as any;
      }
      if (url.includes("/prompt")) {
        promptCalls++;
        const err: any = new Error("Request failed with status code 503");
        err.response = { status: 503, data: { error: "gpu_busy" } };
        throw err;
      }
      return { data: {} } as any;
    });

    vi.spyOn(axios, "get").mockResolvedValue({ status: 404, data: {} } as any);

    const tinyPngDataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    await expect(
      generateVideoWithModel({
        imageUrl: tinyPngDataUri,
        occasion: "Birthday",
        aiEngine: "svd",
      })
    ).rejects.toThrow(/FLUX \/ SVD video generation failed.*switch to another AI video model/i);

    expect(promptCalls).toBe(2);
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
