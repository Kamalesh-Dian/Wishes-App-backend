import { describe, it, expect, vi } from "vitest";
import { generateImage } from "../services/image.service";
import * as fluxService from "../services/providers/flux.service";
import * as geminiService from "../services/providers/gemini.service";
import * as cloudinaryService from "../services/cloudinary.service";
import { generateVideoWithModel } from "../services/video.service";

describe("Task 5: Honest Fallbacks", () => {
  it("wraps FLUX and falls back honestly to Gemini when FLUX providers fail", async () => {
    vi.spyOn(fluxService, "generateWithFlux").mockRejectedValueOnce(
      new Error("Hugging Face quota exhausted and ComfyUI unavailable")
    );

    vi.spyOn(geminiService, "generateWithGemini").mockResolvedValueOnce({
      base64: "dGVzdC1nZW1pbmktYmFzZTY0",
      mimeType: "image/png",
    });

    const result = await generateImage("Celebration prompt", undefined, "flux");

    expect(result.provider).toBe("gemini-fallback");
    expect(result.base64).toBe("dGVzdC1nZW1pbmktYmFzZTY0");
    expect(result.mimeType).toBe("image/png");
  });

  it("returns provider as flux-comfy when ComfyUI FLUX succeeds", async () => {
    vi.spyOn(fluxService, "generateWithFlux").mockResolvedValueOnce({
      base64: "Zmx1eC1jb21meS1pbWFnZQ==",
      mimeType: "image/png",
      provider: "flux-comfy",
    });

    const result = await generateImage("Birthday celebration", undefined, "flux");
    expect(result.provider).toBe("flux-comfy");
  });

  it("assigns tier 'animated-card' when final fallback is reached", async () => {
    vi.spyOn(cloudinaryService, "uploadToCloudinary").mockResolvedValue(
      "https://res.cloudinary.com/demo/image/upload/sample.png"
    );
    vi.spyOn(cloudinaryService, "uploadVideoToCloudinary").mockResolvedValue(
      "https://res.cloudinary.com/demo/video/upload/sample.mp4"
    );

    const res = await generateVideoWithModel({
      imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      occasion: "Birthday",
      aiEngine: "non-existent-engine",
    });

    expect(res.tier).toBe("animated-card");
    expect(res.model).toContain("Neural Dynamic Motion Engine");
  });
});
