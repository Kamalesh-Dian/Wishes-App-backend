import { describe, it, expect, vi, beforeEach } from "vitest";
import Event from "../models/Event";
import OneDriveConnection from "../models/OneDriveConnection";
import { generateTodayEvents, recoverStuckEvents } from "../services/automation/scheduler.service";
import * as automationService from "../services/automation/automation.service";

vi.mock("../models/Event", () => {
  const mockModel: any = vi.fn();
  mockModel.find = vi.fn();
  mockModel.updateMany = vi.fn();
  mockModel.findOneAndUpdate = vi.fn();
  mockModel.findByIdAndUpdate = vi.fn();
  return { default: mockModel };
});

vi.mock("../models/OneDriveConnection", () => {
  const mockModel: any = vi.fn();
  mockModel.find = vi.fn().mockResolvedValue([]);
  return { default: mockModel };
});

vi.mock("../services/automation/automation.service", () => ({
  generateEventWish: vi.fn(),
}));

vi.mock("../services/email/sendWishMail", () => ({
  sendWishMail: vi.fn(),
}));

describe("Scheduler Recovery & Retry Logic (Item 10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("recoverStuckEvents", () => {
    it("should reset events stuck in generating or sending for >15 minutes back to pending", async () => {
      vi.mocked(Event.updateMany).mockResolvedValueOnce({
        modifiedCount: 3,
      } as any);

      const recovered = await recoverStuckEvents();

      expect(recovered).toBe(3);
      expect(Event.updateMany).toHaveBeenCalledWith(
        {
          status: { $in: ["generating", "sending"] },
          updatedAt: { $lt: expect.any(Date) },
        },
        {
          $set: {
            status: "pending",
            lastError: "Recovered from stuck state (>15 min)",
          },
        }
      );
    });
  });

  describe("Retry behavior on failure", () => {
    it("should update attempts and schedule retry if attempts < 3", async () => {
      const mockEvent = {
        _id: "event-attempt-1",
        name: "Charlie",
        email: "charlie@example.com",
        occasion: "Work Anniversary",
        attempts: 1, // First attempt just claimed
      };

      vi.mocked(Event.updateMany).mockResolvedValueOnce({ modifiedCount: 0 } as any);
      vi.mocked(Event.findOneAndUpdate)
        .mockResolvedValueOnce(mockEvent as any)
        .mockResolvedValueOnce(null);

      vi.mocked(automationService.generateEventWish).mockRejectedValueOnce(
        new Error("AI Model Rate Limit")
      );

      await generateTodayEvents();

      expect(Event.findByIdAndUpdate).toHaveBeenCalledWith("event-attempt-1", {
        status: "failed",
        lastError: "AI Model Rate Limit",
      });
    });

    it("should mark permanently failed and log alert when 3 attempts are exhausted", async () => {
      const mockEvent = {
        _id: "event-attempt-3",
        name: "Dana",
        email: "dana@example.com",
        occasion: "Birthday",
        attempts: 3, // Third attempt
      };

      vi.mocked(Event.updateMany).mockResolvedValueOnce({ modifiedCount: 0 } as any);
      vi.mocked(Event.findOneAndUpdate)
        .mockResolvedValueOnce(mockEvent as any)
        .mockResolvedValueOnce(null);

      vi.mocked(automationService.generateEventWish).mockRejectedValueOnce(
        new Error("Persistent Cloudinary Error")
      );

      await generateTodayEvents();

      expect(Event.findByIdAndUpdate).toHaveBeenCalledWith("event-attempt-3", {
        status: "failed",
        lastError: expect.stringContaining("Max retries exceeded: Persistent Cloudinary Error"),
      });
    });
  });
});
