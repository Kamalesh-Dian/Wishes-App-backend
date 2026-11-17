import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import generateRoutes from "../routes/generate.routes";
import Wish from "../models/Wish";
import { firebaseAuth } from "../config/firebase";
import * as imageService from "../services/image.service";
import * as cloudinaryService from "../services/cloudinary.service";

vi.mock("../config/firebase", () => ({
  firebaseAuth: {
    verifyIdToken: vi.fn(),
  },
}));

vi.mock("../models/Wish", () => {
  const mockModel: any = vi.fn();
  mockModel.create = vi.fn();
  mockModel.countDocuments = vi.fn();
  return { default: mockModel };
});

vi.mock("../services/image.service", () => ({
  generateImage: vi.fn(),
}));

vi.mock("../services/cloudinary.service", () => ({
  uploadToCloudinary: vi.fn(),
}));

const app = express();
app.use(express.json());
app.use("/api/generate", generateRoutes);

describe("Generation Controller Hardening (Item 13)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(firebaseAuth.verifyIdToken).mockResolvedValue({
      uid: "user-gen-123",
    } as any);
  });

  it("should return 400 if occasion or theme is missing", async () => {
    const res = await request(app)
      .post("/api/generate")
      .set("Authorization", "Bearer valid-token")
      .send({
        theme: "Corporate",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(res.body.details.occasion).toBeDefined();
  });

  it("should return 400 if additionalInformation exceeds 100 characters", async () => {
    const res = await request(app)
      .post("/api/generate")
      .set("Authorization", "Bearer valid-token")
      .send({
        occasion: "Birthday",
        theme: "Retro",
        additionalInformation: "A".repeat(101),
      });

    expect(res.status).toBe(400);
    expect(res.body.details.additionalInformation).toBeDefined();
  });

  it("should return 400 if aiEngine is not an allowed enum value", async () => {
    const res = await request(app)
      .post("/api/generate")
      .set("Authorization", "Bearer valid-token")
      .send({
        occasion: "Birthday",
        theme: "Retro",
        aiEngine: "untrusted-ai-model",
      });

    expect(res.status).toBe(400);
    expect(res.body.details.aiEngine).toBeDefined();
  });

  it("should return 429 when daily generation limit is reached", async () => {
    vi.mocked(Wish.countDocuments).mockResolvedValueOnce(20 as any);

    const res = await request(app)
      .post("/api/generate")
      .set("Authorization", "Bearer valid-token")
      .send({
        occasion: "Birthday",
        theme: "Neon",
      });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain("Daily generation limit");
  });

  it("should return sanitized 500 error without leaking upstream API secret or stack trace", async () => {
    vi.mocked(Wish.countDocuments).mockResolvedValueOnce(0 as any);
    vi.mocked(imageService.generateImage).mockRejectedValueOnce(
      new Error("HuggingFace API Key 'hf_xyz123' quota exhausted on endpoint https://internal.cluster/v1")
    );

    const res = await request(app)
      .post("/api/generate")
      .set("Authorization", "Bearer valid-token")
      .send({
        occasion: "Birthday",
        theme: "Minimalist",
      });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("An error occurred while generating your wish. Please try again later.");
    expect(res.body.error).not.toContain("hf_xyz123");
  });

  it("should successfully generate wish when body and limit are valid", async () => {
    vi.mocked(Wish.countDocuments).mockResolvedValueOnce(5 as any);
    vi.mocked(imageService.generateImage).mockResolvedValueOnce({
      base64: "base64imagepayload",
      mimeType: "image/png",
    });
    vi.mocked(cloudinaryService.uploadToCloudinary).mockResolvedValueOnce(
      "https://res.cloudinary.com/demo/image/upload/sample.png"
    );
    vi.mocked(Wish.create).mockResolvedValueOnce({
      _id: "wish-created-456",
    } as any);

    const res = await request(app)
      .post("/api/generate")
      .set("Authorization", "Bearer valid-token")
      .send({
        occasion: "Work Anniversary",
        theme: "Corporate",
        people: ["Alice"],
        decorations: ["Balloons"],
        aiEngine: "gemini",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.imageURL).toBe("https://res.cloudinary.com/demo/image/upload/sample.png");
    expect(res.body.wishId).toBe("wish-created-456");
  });
});
