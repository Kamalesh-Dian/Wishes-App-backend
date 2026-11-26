import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../app";

vi.mock("../config/firebase", () => ({
  firebaseAuth: {
    verifyIdToken: vi.fn(),
  },
}));

vi.mock("../config/cloudinary", () => ({
  default: {
    uploader: {
      upload: vi.fn(),
    },
  },
}));

describe("App Hardening & Security Middleware (Item 3)", () => {
  beforeEach(() => {
    process.env.FRONTEND_URL = "http://localhost:5173,https://wishes.example.com";
  });

  it("should include Helmet security headers in responses", async () => {
    const res = await request(app).get("/api/events");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-dns-prefetch-control"]).toBe("off");
  });

  it("should allow CORS requests from configured FRONTEND_URL", async () => {
    const res = await request(app)
      .get("/api/events")
      .set("Origin", "http://localhost:5173");

    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("should include standard rate-limiting headers on /api requests", async () => {
    const res = await request(app).get("/api/events");
    // express-rate-limit standardHeaders draft-8 sets ratelimit headers
    expect(res.headers["ratelimit-limit"] || res.headers["x-ratelimit-limit"]).toBeDefined();
  });

  it("should skip strict rate limiting on async status polling endpoint", async () => {
    const res = await request(app).get("/api/generate/test-wish-id/status");
    // Skipped by both generalLimiter and strictLimiter, so no ratelimit headers and never 429
    expect(res.status).not.toBe(429);
    expect(res.headers["ratelimit-limit"]).toBeUndefined();
  });
});
