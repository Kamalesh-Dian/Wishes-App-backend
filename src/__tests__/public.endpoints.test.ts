import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import automationRoutes from "../routes/automation.routes";
import uploadRoutes from "../routes/upload.routes";
import { firebaseAuth } from "../config/firebase";

vi.mock("../config/firebase", () => ({
  firebaseAuth: {
    verifyIdToken: vi.fn(),
  },
}));

vi.mock("../services/automation/scheduler.service", () => ({
  generateTodayEvents: vi.fn().mockResolvedValue(5),
}));

vi.mock("../config/cloudinary", () => ({
  default: {
    uploader: {
      upload: vi.fn().mockResolvedValue({ secure_url: "https://res.cloudinary.com/demo/image.png" }),
    },
  },
}));

const app = express();
app.use(express.json());
app.use("/api/automation", automationRoutes);
app.use("/api/upload", uploadRoutes);

describe("Public Endpoints Security (Item 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_UIDS = "admin-1,admin-2";
  });

  describe("POST /api/automation/run", () => {
    it("should return 401 when calling automation run without auth token", async () => {
      const res = await request(app).post("/api/automation/run");
      expect(res.status).toBe(401);
    });

    it("should return 403 when authenticated as a non-admin user", async () => {
      vi.mocked(firebaseAuth.verifyIdToken).mockResolvedValueOnce({
        uid: "regular-user",
        email: "user@example.com",
      } as any);

      const res = await request(app)
        .post("/api/automation/run")
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Admin access required");
    });

    it("should allow execution when authenticated user is in ADMIN_UIDS", async () => {
      vi.mocked(firebaseAuth.verifyIdToken).mockResolvedValueOnce({
        uid: "admin-1",
        email: "admin@example.com",
      } as any);

      const res = await request(app)
        .post("/api/automation/run")
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.processed).toBe(5);
    });
  });

  describe("POST /api/upload", () => {
    it("should return 401 when uploading without token", async () => {
      const res = await request(app)
        .post("/api/upload")
        .attach("image", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(401);
    });

    it("should reject non-image file types with 400", async () => {
      vi.mocked(firebaseAuth.verifyIdToken).mockResolvedValueOnce({
        uid: "user-1",
        email: "user@example.com",
      } as any);

      const res = await request(app)
        .post("/api/upload")
        .set("Authorization", "Bearer valid-token")
        .attach("image", Buffer.from("alert('xss')"), {
          filename: "malicious.js",
          contentType: "application/javascript",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Only JPEG, PNG, and WebP are allowed");
    });

    it("should reject files over 5 MB with 400", async () => {
      vi.mocked(firebaseAuth.verifyIdToken).mockResolvedValueOnce({
        uid: "user-1",
        email: "user@example.com",
      } as any);

      // Create a buffer larger than 5MB
      const largeBuffer = Buffer.alloc(5.5 * 1024 * 1024);

      const res = await request(app)
        .post("/api/upload")
        .set("Authorization", "Bearer valid-token")
        .attach("image", largeBuffer, {
          filename: "huge.jpg",
          contentType: "image/jpeg",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("File size exceeds 5MB limit");
    });
  });
});
