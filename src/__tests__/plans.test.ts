import { describe, it, expect, vi, beforeEach } from "vitest";
import { PLAN_LIMITS, getBillingMonthRange, getPlanConfigMap } from "../config/plans";
import Wish from "../models/Wish";
import User from "../models/User";
import { getUserMonthlyUsage } from "../services/usage.service";
import { generateWish } from "../controllers/generate.controller";
import { getMe } from "../controllers/user.controller";

describe("Task 8: Subscription Tiers and Plan Limits", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("defines correct plan limits for free, pro, and ultimate", () => {
    expect(PLAN_LIMITS.free).toEqual({ images: 5, videos: 3 });
    expect(PLAN_LIMITS.pro).toEqual({ images: 40, videos: 10 });
    expect(PLAN_LIMITS.ultimate).toEqual({ images: 75, videos: 25 });
  });

  it("reads configurable plan pricing and quotas from environment variables", () => {
    const prevProPrice = process.env.PLAN_PRO_PRICE;
    const prevProImages = process.env.PLAN_PRO_IMAGES;
    const prevCurrency = process.env.PLAN_CURRENCY;

    process.env.PLAN_CURRENCY = "₹";
    process.env.PLAN_PRO_PRICE = "499";
    process.env.PLAN_PRO_IMAGES = "60";

    try {
      const cfg = getPlanConfigMap();
      expect(cfg.pro.currency).toBe("₹");
      expect(cfg.pro.price).toBe(499);
      expect(cfg.pro.images).toBe(60);
    } finally {
      if (prevProPrice !== undefined) process.env.PLAN_PRO_PRICE = prevProPrice;
      else delete process.env.PLAN_PRO_PRICE;
      if (prevProImages !== undefined) process.env.PLAN_PRO_IMAGES = prevProImages;
      else delete process.env.PLAN_PRO_IMAGES;
      if (prevCurrency !== undefined) process.env.PLAN_CURRENCY = prevCurrency;
      else delete process.env.PLAN_CURRENCY;
    }
  });

  it("computes monthly billing range starting from day 1 of current month", () => {
    const fixedDate = new Date(2026, 10, 15); // Nov 15, 2026
    const { start, end } = getBillingMonthRange(fixedDate);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(10);
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(11);
    expect(end.getDate()).toBe(1);
  });

  it("counts images and videos separately per user for current billing month", async () => {
    const mockCountDocuments = vi.spyOn(Wish, "countDocuments");
    // First call for images: 4
    // Second call for videos: 1
    mockCountDocuments
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(1);

    const usage = await getUserMonthlyUsage("user-123");
    expect(usage.images).toBe(4);
    expect(usage.videos).toBe(1);
    expect(mockCountDocuments).toHaveBeenCalledTimes(2);
  });

  it("free user receives 403 when 3 video generations limit is reached", async () => {
    vi.spyOn(User, "findOne").mockResolvedValue({
      uid: "free-user-1",
      plan: "free",
    } as any);

    vi.spyOn(Wish, "countDocuments")
      .mockResolvedValueOnce(1) // images usage
      .mockResolvedValueOnce(3); // videos usage (3/3 reached)

    const req: any = {
      user: { uid: "free-user-1", email: "user@example.com" },
      body: {
        occasion: "Birthday",
        theme: "Festive Home",
        animationEnabled: true,
      },
    };

    let statusCaptured = 0;
    let jsonCaptured: any = null;
    const res: any = {
      status: (code: number) => {
        statusCaptured = code;
        return res;
      },
      json: (data: any) => {
        jsonCaptured = data;
        return res;
      },
    };

    await generateWish(req, res);

    expect(statusCaptured).toBe(403);
    expect(jsonCaptured?.error).toContain("Video generation limit reached for FREE plan (3/3 videos used)");
  });

  it("free user can generate image when animationEnabled is false even if videoModel is passed", async () => {
    vi.spyOn(User, "findOne").mockResolvedValue({
      uid: "free-user-1",
      plan: "free",
    } as any);

    vi.spyOn(Wish, "countDocuments").mockResolvedValue(0);
    vi.spyOn(Wish, "create").mockResolvedValue({
      _id: "wish-free-img-123",
      status: "queued",
    } as any);

    const req: any = {
      user: { uid: "free-user-1", email: "user@example.com" },
      body: {
        occasion: "Birthday",
        theme: "Festive Home",
        animationEnabled: false,
        videoModel: "gemini-omni",
        aiEngine: "gemini",
      },
    };

    let jsonCaptured: any = null;
    const res: any = {
      json: (data: any) => {
        jsonCaptured = data;
        return res;
      },
      status: () => res,
    };

    await generateWish(req, res);

    expect(jsonCaptured?.success).toBe(true);
    expect(jsonCaptured?.status).toBe("queued");
    expect(jsonCaptured?.wishId).toBe("wish-free-img-123");
  });

  it("returns 403 with upgrade message when image limit is reached", async () => {
    vi.spyOn(User, "findOne").mockResolvedValue({
      uid: "free-user-2",
      plan: "free",
    } as any);

    // Free user already used 5 images
    vi.spyOn(Wish, "countDocuments")
      .mockResolvedValueOnce(5) // images usage
      .mockResolvedValueOnce(0); // videos usage

    const req: any = {
      user: { uid: "free-user-2", email: "user@example.com" },
      body: {
        occasion: "Birthday",
        theme: "Festive Home",
        animationEnabled: false,
      },
    };

    let statusCaptured = 0;
    let jsonCaptured: any = null;
    const res: any = {
      status: (code: number) => {
        statusCaptured = code;
        return res;
      },
      json: (data: any) => {
        jsonCaptured = data;
        return res;
      },
    };

    await generateWish(req, res);

    expect(statusCaptured).toBe(403);
    expect(jsonCaptured?.error).toContain("Image generation limit reached for FREE plan (5/5 images used)");
  });

  it("GET /api/me returns user's plan, image/video limits, and monthly usage", async () => {
    vi.spyOn(User, "findOne").mockResolvedValue({
      uid: "pro-user-1",
      email: "pro@example.com",
      displayName: "Pro User",
      plan: "pro",
    } as any);

    vi.spyOn(Wish, "countDocuments")
      .mockResolvedValueOnce(12) // images used
      .mockResolvedValueOnce(3);  // videos used

    const req: any = {
      user: { uid: "pro-user-1", email: "pro@example.com" },
    };

    let jsonCaptured: any = null;
    const res: any = {
      json: (data: any) => {
        jsonCaptured = data;
        return res;
      },
    };

    await getMe(req, res);

    expect(jsonCaptured?.success).toBe(true);
    expect(jsonCaptured?.plan).toBe("pro");
    expect(jsonCaptured?.usage).toEqual(expect.objectContaining({
      images: 12,
      videos: 3,
    }));
    expect(jsonCaptured?.limits).toEqual({
      images: 40,
      videos: 10,
    });
    expect(jsonCaptured?.remainingImages).toBe(28);
    expect(jsonCaptured?.remainingVideos).toBe(7);
  });
});
