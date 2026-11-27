import { describe, it, expect, vi } from "vitest";
import { generateImage } from "../services/image.service";
import * as fluxService from "../services/providers/flux.service";
import * as geminiService from "../services/providers/gemini.service";
import { generateVideoWithModel } from "../services/video.service";

describe("Task 5: Honest Fallbacks", () => {
  it("sticks strictly to FLUX and throws an error advising another model when FLUX fails", async () => {
    vi.spyOn(fluxService, "generateWithFlux").mockRejectedValueOnce(
      new Error("Hugging Face quota exhausted and ComfyUI unavailable")
    );
    const geminiSpy = vi.spyOn(geminiService, "generateWithGemini");

    await expect(
      generateImage("Celebration prompt", undefined, "flux")
    ).rejects.toThrow(/FLUX image generation failed.*switch to another AI model/i);

    expect(geminiSpy).not.toHaveBeenCalled();
  });

  it("sticks strictly to FLUX/SVD for video and throws an error without falling back when FLUX/SVD fails", async () => {
    const prevComfy = process.env.COMFY_API_URL;
    const prevVideo = process.env.VIDEO_API_URL;
    const prevFlux = process.env.FLUX_API_URL;
    delete process.env.COMFY_API_URL;
    delete process.env.VIDEO_API_URL;
    delete process.env.FLUX_API_URL;

    try {
      await expect(
        generateVideoWithModel({
          imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          occasion: "Birthday",
          aiEngine: "flux",
        })
      ).rejects.toThrow(/FLUX \/ SVD video generation failed.*switch to another AI video model/i);
    } finally {
      if (prevComfy !== undefined) process.env.COMFY_API_URL = prevComfy;
      if (prevVideo !== undefined) process.env.VIDEO_API_URL = prevVideo;
      if (prevFlux !== undefined) process.env.FLUX_API_URL = prevFlux;
    }
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

  it("sticks strictly to Gemini for video and throws an error without falling back when Gemini fails", async () => {
    const prevKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      await expect(
        generateVideoWithModel({
          imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          occasion: "Birthday",
          aiEngine: "gemini",
        })
      ).rejects.toThrow(/Gemini video generation failed.*switch to another AI video model/i);
    } finally {
      if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    }
  });
});
