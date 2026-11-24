import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import User from "../models/User";
import { PLAN_LIMITS, type PlanTier } from "../config/plans";
import { getUserMonthlyUsage } from "../services/usage.service";
import { logger } from "../utils/logger";

export async function getMe(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    let user = await User.findOne({ uid: userId });
    if (!user) {
      let defaultPlan: PlanTier = "free";
      if (process.env.ENABLE_DEMO_ACCOUNTS === "true" && req.user?.email) {
        const demoEmail = req.user.email.toLowerCase();
        if (demoEmail.includes("ultimate")) defaultPlan = "ultimate";
        else if (demoEmail.includes("pro")) defaultPlan = "pro";
      }
      user = await User.create({
        uid: userId,
        email: req.user?.email || `${userId}@wishes.ai`,
        plan: defaultPlan,
      });
    }

    let plan = (user.plan as PlanTier) || "free";
    if (process.env.ENABLE_DEMO_ACCOUNTS === "true" && req.user?.email) {
      const demoEmail = req.user.email.toLowerCase();
      if (demoEmail.includes("ultimate")) plan = "ultimate";
      else if (demoEmail.includes("pro")) plan = "pro";
    }

    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    const usage = await getUserMonthlyUsage(userId);
    const now = new Date();
    const billingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    return res.json({
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        plan,
      },
      plan,
      usage: {
        images: usage.images,
        videos: usage.videos,
        billingMonth,
      },
      limits: {
        images: limits.images,
        videos: limits.videos,
      },
      usedImages: usage.images,
      usedVideos: usage.videos,
      remainingImages: Math.max(0, limits.images - usage.images),
      remainingVideos: Math.max(0, limits.videos - usage.videos),
    });
  } catch (err) {
    logger.error({ err }, "Error in getMe");
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}
