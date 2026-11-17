import { describe, it, expect, vi, beforeEach } from "vitest";
import Event from "../models/Event";
import OneDriveConnection from "../models/OneDriveConnection";
import { generateTodayEvents } from "../services/automation/scheduler.service";
import * as automationService from "../services/automation/automation.service";
import * as mailService from "../services/email/sendWishMail";

vi.mock("../models/Event", () => {
  const mockModel: any = vi.fn();
  mockModel.find = vi.fn();
  mockModel.updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
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

describe("Scheduler Atomic Claiming & Concurrency Guard (Item 9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should claim events one by one via findOneAndUpdate until null is returned", async () => {
    const mockEvent1 = {
      _id: "event-1",
      name: "Alice",
      email: "alice@example.com",
      occasion: "Birthday",
    };
    const mockEvent2 = {
      _id: "event-2",
      name: "Bob",
      email: "bob@example.com",
      occasion: "Anniversary",
    };

    // First two calls return an event, third call returns null
    vi.mocked(Event.findOneAndUpdate)
      .mockResolvedValueOnce(mockEvent1 as any)
      .mockResolvedValueOnce(mockEvent2 as any)
      .mockResolvedValueOnce(null);

    vi.mocked(automationService.generateEventWish).mockResolvedValue({
      event: { generatedWishImage: "https://cloudinary.com/img.png" },
    } as any);

    vi.mocked(mailService.sendWishMail).mockResolvedValue(true as any);

    const count = await generateTodayEvents();

    expect(count).toBe(2);
    expect(Event.findOneAndUpdate).toHaveBeenCalledTimes(3);

    // Verify atomic query structure
    expect(Event.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.any(Object),
          expect.objectContaining({
            $or: expect.arrayContaining([expect.objectContaining({ status: "pending" })]),
          }),
        ]),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "generating",
          claimedAt: expect.any(Date),
        }),
      }),
      { new: true }
    );
  });

  it("should guard against overlapping executions when already running", async () => {
    // Hang on first claim
    let resolveFirstClaim: (val: any) => void;
    const pendingPromise = new Promise((resolve) => {
      resolveFirstClaim = resolve;
    });

    vi.mocked(Event.findOneAndUpdate).mockImplementationOnce(() => pendingPromise as any);

    // Start first run
    const run1Promise = generateTodayEvents();

    // Start concurrent run immediately
    const run2Promise = generateTodayEvents();

    // Run 2 should return 0 immediately because run 1 is active
    const run2Result = await run2Promise;
    expect(run2Result).toBe(0);

    // Now complete run 1
    resolveFirstClaim!(null);
    const run1Result = await run1Promise;
    expect(run1Result).toBe(0);
  });
});
