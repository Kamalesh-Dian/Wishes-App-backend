import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { compareFaces, getMinSimilarityThreshold } from "../services/identityCheck.service";

describe("Task 6: Identity Check Service", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("skips comparison silently and returns null when IDENTITY_CHECK_URL is not configured", async () => {
    delete process.env.IDENTITY_CHECK_URL;
    const result = await compareFaces("data:image/png;base64,aaa", "data:image/png;base64,bbb");
    expect(result).toBeNull();
  });

  it("calls identity check endpoint when IDENTITY_CHECK_URL is set and returns similarity", async () => {
    process.env.IDENTITY_CHECK_URL = "http://localhost:8001";
    vi.spyOn(axios, "post").mockResolvedValueOnce({
      data: {
        similarity: 0.68,
        matched: true,
      },
    });

    const score = await compareFaces("data:image/png;base64,face1", "data:image/png;base64,face2");
    expect(score).toBe(0.68);
    expect(axios.post).toHaveBeenCalledWith(
      "http://localhost:8001/compare",
      expect.objectContaining({
        image1: "data:image/png;base64,face1",
        image2: "data:image/png;base64,face2",
      }),
      expect.any(Object)
    );
  });

  it("falls back gracefully to null when identity service is unreachable", async () => {
    process.env.IDENTITY_CHECK_URL = "http://localhost:8001";
    vi.spyOn(axios, "post").mockRejectedValueOnce(new Error("Connection refused"));

    const score = await compareFaces("data:image/png;base64,face1", "data:image/png;base64,face2");
    expect(score).toBeNull();
  });

  it("reads configurable IDENTITY_MIN_SIMILARITY threshold with 0.45 default", () => {
    delete process.env.IDENTITY_MIN_SIMILARITY;
    expect(getMinSimilarityThreshold()).toBe(0.45);

    process.env.IDENTITY_MIN_SIMILARITY = "0.60";
    expect(getMinSimilarityThreshold()).toBe(0.60);
  });
});
