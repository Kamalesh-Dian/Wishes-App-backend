import Wish from "../models/Wish";
import { getBillingMonthRange, getEffectiveUsageStart } from "../config/plans";

export interface MonthlyUsage {
  images: number;
  videos: number;
}

/**
 * Counts images and videos separately per user for the current billing month.
 * - An image counts if wish completed image generation (status in done/video/image or imageUrl exists).
 * - A video counts only if video generation was actually performed and succeeded (videoUrl exists and not empty).
 */
export async function getUserMonthlyUsage(userId: string, date: Date = new Date()): Promise<MonthlyUsage> {
  const { start, end } = getBillingMonthRange(date);
  const effectiveStart = getEffectiveUsageStart(start, end);

  const images = await Wish.countDocuments({
    user: userId,
    createdAt: { $gte: effectiveStart, $lt: end },
    $or: [
      { status: { $in: ["done", "video", "image"] } },
      { imageUrl: { $exists: true, $ne: "" } },
    ],
  });

  const videos = await Wish.countDocuments({
    user: userId,
    createdAt: { $gte: effectiveStart, $lt: end },
    videoUrl: { $exists: true, $nin: [null, ""] },
  });

  return { images, videos };
}
