import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import onedriveRoutes from "../routes/onedrive.routes";
import OneDriveConnection from "../models/OneDriveConnection";
import { firebaseAuth } from "../config/firebase";
import { encrypt, decrypt } from "../utils/encryption";

vi.mock("../config/firebase", () => ({
  firebaseAuth: {
    verifyIdToken: vi.fn(),
  },
}));

vi.mock("../models/OneDriveConnection", () => {
  const mockModel: any = vi.fn();
  mockModel.findOne = vi.fn();
  mockModel.findOneAndUpdate = vi.fn();
  mockModel.updateOne = vi.fn();
  return { default: mockModel };
});

const app = express();
app.use(express.json());
app.use("/api/onedrive", onedriveRoutes);

describe("OneDrive Token Security & Status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("AES-256-GCM Encryption Utility", () => {
    it("should encrypt and decrypt a sensitive token correctly", () => {
      const originalToken = "eyJhbGciOiJSUzI1NiIsIng1dCI6...secret_microsoft_token";
      const encrypted = encrypt(originalToken);

      expect(encrypted).not.toBe(originalToken);
      const parts = encrypted.split(":");
      expect(parts.length).toBe(3); // iv:tag:data
      expect(parts[0].length).toBe(24); // 12-byte IV in hex is 24 chars
      expect(parts[1].length).toBe(32); // 16-byte tag in hex is 32 chars

      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(originalToken);
    });

    it("should return empty string for falsy input", () => {
      expect(encrypt("")).toBe("");
      expect(decrypt("")).toBe("");
    });

    it("should fail to decrypt if ciphertext is tampered", () => {
      const encrypted = encrypt("my-secret-token");
      const parts = encrypted.split(":");
      // Corrupt the ciphertext part
      const tampered = `${parts[0]}:${parts[1]}:deadbeef${parts[2].slice(8)}`;
      expect(() => decrypt(tampered)).toThrow();
    });
  });

  describe("GET /api/onedrive/status", () => {
    it("should require authentication", async () => {
      const res = await request(app).get("/api/onedrive/status");
      expect(res.status).toBe(401);
    });

    it("should return connected: false when no connection exists", async () => {
      vi.mocked(firebaseAuth.verifyIdToken).mockResolvedValueOnce({
        uid: "user-123",
      } as any);
      vi.mocked(OneDriveConnection.findOne).mockResolvedValueOnce(null);

      const res = await request(app)
        .get("/api/onedrive/status")
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ connected: false });
      expect(OneDriveConnection.findOne).toHaveBeenCalledWith({ userId: "user-123" });
    });

    it("should return connection status with needsReconnect flag", async () => {
      vi.mocked(firebaseAuth.verifyIdToken).mockResolvedValueOnce({
        uid: "user-123",
      } as any);
      vi.mocked(OneDriveConnection.findOne).mockResolvedValueOnce({
        userId: "user-123",
        fileName: "Employees.xlsx",
        syncEnabled: true,
        needsReconnect: true,
        lastError: "Microsoft Graph access token expired",
        lastSync: new Date("2026-11-15T00:00:00Z"),
      } as any);

      const res = await request(app)
        .get("/api/onedrive/status")
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(true);
      expect(res.body.fileName).toBe("Employees.xlsx");
      expect(res.body.needsReconnect).toBe(true);
      expect(res.body.lastError).toContain("token expired");
    });
  });
});
