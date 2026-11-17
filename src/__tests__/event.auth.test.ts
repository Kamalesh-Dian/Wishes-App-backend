import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import eventRoutes from "../routes/event.routes";
import Event from "../models/Event";
import { firebaseAuth } from "../config/firebase";

vi.mock("../config/firebase", () => ({
  firebaseAuth: {
    verifyIdToken: vi.fn(),
  },
}));

vi.mock("../models/Event", () => {
  const mockModel: any = vi.fn();
  mockModel.find = vi.fn();
  mockModel.findOneAndUpdate = vi.fn();
  mockModel.findOneAndDelete = vi.fn();
  mockModel.insertMany = vi.fn();
  mockModel.deleteMany = vi.fn();
  return { default: mockModel };
});

const app = express();
app.use(express.json());
app.use("/api/events", eventRoutes);

describe("Event API Auth & Authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 on GET /api/events without Authorization header", async () => {
    const res = await request(app).get("/api/events");
    expect(res.status).toBe(401);
    expect(res.body.message).toContain("No token");
  });

  it("should return 401 when spoofing firebase-uid header without valid token", async () => {
    const res = await request(app)
      .get("/api/events")
      .set("firebase-uid", "attacker-uid");
    expect(res.status).toBe(401);
  });

  it("should isolate user events and use decoded token uid, ignoring spoofed header", async () => {
    vi.mocked(firebaseAuth.verifyIdToken).mockResolvedValueOnce({
      uid: "legit-user-123",
      email: "user@example.com",
    } as any);

    const mockSort = vi.fn().mockResolvedValueOnce([
      { _id: "event-1", name: "Alice", userId: "legit-user-123" },
    ]);
    vi.mocked(Event.find).mockReturnValueOnce({ sort: mockSort } as any);

    const res = await request(app)
      .get("/api/events")
      .set("Authorization", "Bearer valid-token")
      .set("firebase-uid", "spoofed-uid-attacker");

    expect(res.status).toBe(200);
    expect(Event.find).toHaveBeenCalledWith({ userId: "legit-user-123" });
  });

  it("should return 404 when updating an event belonging to another user", async () => {
    vi.mocked(firebaseAuth.verifyIdToken).mockResolvedValueOnce({
      uid: "user-123",
      email: "user@example.com",
    } as any);

    vi.mocked(Event.findOneAndUpdate).mockResolvedValueOnce(null);

    const res = await request(app)
      .put("/api/events/other-user-event-id")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Updated Name" });

    expect(res.status).toBe(404);
    expect(Event.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "other-user-event-id", userId: "user-123" },
      { $set: { name: "Updated Name" } },
      { new: true }
    );
  });
});
