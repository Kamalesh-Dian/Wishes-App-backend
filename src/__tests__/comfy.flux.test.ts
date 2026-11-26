import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { generateImageWithComfy, generateVideoWithComfy } from "../services/comfy.service";
import * as cloudinaryService from "../services/cloudinary.service";

describe("ComfyUI FLUX.2 Klein ReferenceLatent Workflow", () => {
  const originalComfyUrl = process.env.COMFY_API_URL;

  beforeEach(() => {
    process.env.COMFY_API_URL = "http://localhost:8188";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalComfyUrl !== undefined) {
      process.env.COMFY_API_URL = originalComfyUrl;
    } else {
      delete process.env.COMFY_API_URL;
    }
  });

  it("uses ReferenceLatent with denoise=1.0 when an uploaded photo is provided", async () => {
    let capturedGraph: Record<string, any> = {};

    vi.spyOn(axios, "post").mockImplementation(async (url: string, data: any) => {
      if (url.endsWith("/upload/image")) {
        return { data: { name: "uploaded_person.png", subfolder: "", type: "input" } };
      }
      if (url.endsWith("/prompt")) {
        capturedGraph = data.prompt;
        return { data: { prompt_id: "prompt-123", number: 1 } };
      }
      throw new Error(`Unexpected POST ${url}`);
    });

    vi.spyOn(axios, "get").mockImplementation(async (url: string) => {
      if (url.includes("/history/prompt-123")) {
        return {
          data: {
            "prompt-123": {
              status: { status_str: "success", completed: true },
              outputs: {
                "10": {
                  images: [{ filename: "WishesAI_Flux_00001_.png", subfolder: "", type: "output" }],
                },
              },
            },
          },
        };
      }
      if (url.includes("/view?")) {
        return { data: Buffer.from("fake-png-bytes") };
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    const tinyPngDataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const result = await generateImageWithComfy("Birthday celebration prompt", tinyPngDataUri);

    expect(result.mimeType).toBe("image/png");
    expect(capturedGraph["6"]?.class_type).toBe("LoadImage");
    expect(capturedGraph["6"]?.inputs?.image).toBe("uploaded_person.png");
    expect(capturedGraph["7"]?.class_type).toBe("VAEEncode");
    expect(capturedGraph["12"]?.class_type).toBe("ReferenceLatent");
    expect(capturedGraph["12"]?.inputs?.conditioning).toEqual(["4", 0]);
    expect(capturedGraph["12"]?.inputs?.latent).toEqual(["7", 0]);
    expect(capturedGraph["13"]?.class_type).toBe("ReferenceLatent");
    expect(capturedGraph["13"]?.inputs?.conditioning).toEqual(["5", 0]);
    expect(capturedGraph["13"]?.inputs?.latent).toEqual(["7", 0]);
    expect(capturedGraph["8"]?.inputs?.positive).toEqual(["12", 0]);
    expect(capturedGraph["8"]?.inputs?.negative).toEqual(["13", 0]);
    expect(capturedGraph["8"]?.inputs?.denoise).toBe(1.0);
  });

  it("uses ComfyUI CreateVideo + SaveVideo (MP4 h264) when available and uploads video/mp4", async () => {
    let capturedGraph: Record<string, any> = {};
    let uploadedPayload = "";

    vi.spyOn(cloudinaryService, "uploadVideoToCloudinary").mockImplementation(async (input: string) => {
      uploadedPayload = input;
      return "https://res.cloudinary.com/demo/video/upload/wishes_svd.mp4";
    });

    vi.spyOn(axios, "post").mockImplementation(async (url: string, data: any) => {
      if (url.endsWith("/upload/image")) {
        return { data: { name: "svd_init.png", subfolder: "", type: "input" } };
      }
      if (url.endsWith("/prompt")) {
        capturedGraph = data.prompt;
        return { data: { prompt_id: "svd-prompt-1", number: 1 } };
      }
      throw new Error(`Unexpected POST ${url}`);
    });

    vi.spyOn(axios, "get").mockImplementation(async (url: string) => {
      if (url.endsWith("/object_info/CreateVideo")) {
        return { status: 200, data: { CreateVideo: {} } };
      }
      if (url.endsWith("/object_info/SaveVideo")) {
        return { status: 200, data: { SaveVideo: {} } };
      }
      if (url.includes("/history/svd-prompt-1")) {
        return {
          data: {
            "svd-prompt-1": {
              status: { status_str: "success", completed: true },
              outputs: {
                "7": {
                  images: [{ filename: "WishesAI_SVD_00001_.mp4", subfolder: "", type: "output" }],
                },
              },
            },
          },
        };
      }
      if (url.includes("/view?")) {
        return { data: Buffer.from("fake-mp4-bytes") };
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    const tinyPngDataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const result = await generateVideoWithComfy({
      imageUrl: tinyPngDataUri,
      occasion: "Birthday",
      duration: 4,
    });

    expect(capturedGraph["6"]?.class_type).toBe("CreateVideo");
    expect(capturedGraph["7"]?.class_type).toBe("SaveVideo");
    expect(capturedGraph["7"]?.inputs?.format).toBe("mp4");
    expect(capturedGraph["7"]?.inputs?.codec).toBe("h264");
    expect(uploadedPayload.startsWith("data:video/mp4;base64,")).toBe(true);
    expect(result.videoUrl).toContain(".mp4");
    expect(result.mimeType).toBe("video/mp4");
  });

  it("enables seamless boomerang extension for 6s-8s SVD videos without extra frames", async () => {
    let capturedOptions: { boomerang?: boolean } | undefined;
    let capturedGraph: Record<string, any> = {};

    vi.spyOn(cloudinaryService, "uploadVideoToCloudinary").mockImplementation(async (_input, opts) => {
      capturedOptions = opts;
      return "https://res.cloudinary.com/demo/video/upload/e_boomerang/wishes_svd.mp4";
    });

    vi.spyOn(axios, "post").mockImplementation(async (url: string, data: any) => {
      if (url.endsWith("/upload/image")) {
        return { data: { name: "svd_init_8s.png", subfolder: "", type: "input" } };
      }
      if (url.endsWith("/prompt")) {
        capturedGraph = data.prompt;
        return { data: { prompt_id: "svd-prompt-8s", number: 1 } };
      }
      throw new Error(`Unexpected POST ${url}`);
    });

    vi.spyOn(axios, "get").mockImplementation(async (url: string) => {
      if (url.endsWith("/object_info/CreateVideo")) {
        return { status: 200, data: { CreateVideo: {} } };
      }
      if (url.endsWith("/object_info/SaveVideo")) {
        return { status: 200, data: { SaveVideo: {} } };
      }
      if (url.includes("/history/svd-prompt-8s")) {
        return {
          data: {
            "svd-prompt-8s": {
              status: { status_str: "success", completed: true },
              outputs: {
                "7": {
                  images: [{ filename: "WishesAI_SVD_8s.mp4", subfolder: "", type: "output" }],
                },
              },
            },
          },
        };
      }
      if (url.includes("/view?")) {
        return { data: Buffer.from("fake-mp4-bytes") };
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    const tinyPngDataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const result = await generateVideoWithComfy({
      imageUrl: tinyPngDataUri,
      occasion: "Birthday",
      duration: 8,
    });

    expect(capturedGraph["3"]?.inputs?.video_frames).toBe(25);
    expect(capturedGraph["6"]?.inputs?.fps).toBe(6);
    expect(capturedOptions?.boomerang).toBe(true);
    expect(result.duration).toBe(8);
  });
});
