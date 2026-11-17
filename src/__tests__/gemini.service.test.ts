import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateWithGemini } from "../services/providers/gemini.service";

describe("Gemini Service Security (Item 6)", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-secret-gemini-key";
    vi.restoreAllMocks();
  });

  it("should send the API key in x-goog-api-key header and NOT in the URL query string", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: "base64data",
                  },
                },
              ],
            },
          },
        ],
      }),
    } as any);

    await generateWithGemini("Happy Birthday Maya");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, requestOptions] = fetchSpy.mock.calls[0] as [string, RequestInit];

    // Ensure the key is NOT in the URL
    expect(calledUrl).not.toContain("key=");
    expect(calledUrl).not.toContain("test-secret-gemini-key");
    expect(calledUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent"
    );

    // Ensure the key IS sent in the header
    const headers = requestOptions.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-secret-gemini-key");
  });
});
