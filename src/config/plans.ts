export type PlanTier = "free" | "pro" | "ultimate";

export interface PlanLimits {
  images: number;
  videos: number;
}

export interface PlanPricingConfig {
  price: number;
  currency: string;
  images: number;
  videos: number;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getPlanConfigMap(): Record<PlanTier, PlanPricingConfig> {
  const currency = process.env.PLAN_CURRENCY?.trim() || "$";
  return {
    free: {
      price: parseNonNegativeInt(process.env.PLAN_FREE_PRICE, 0),
      currency,
      images: parseNonNegativeInt(process.env.PLAN_FREE_IMAGES, 5),
      videos: parseNonNegativeInt(process.env.PLAN_FREE_VIDEOS, 3),
    },
    pro: {
      price: parseNonNegativeInt(process.env.PLAN_PRO_PRICE, 5),
      currency,
      images: parseNonNegativeInt(process.env.PLAN_PRO_IMAGES, 40),
      videos: parseNonNegativeInt(process.env.PLAN_PRO_VIDEOS, 10),
    },
    ultimate: {
      price: parseNonNegativeInt(process.env.PLAN_ULTIMATE_PRICE, 12),
      currency,
      images: parseNonNegativeInt(process.env.PLAN_ULTIMATE_IMAGES, 75),
      videos: parseNonNegativeInt(process.env.PLAN_ULTIMATE_VIDEOS, 25),
    },
  };
}

export function getPlanLimits(tier: PlanTier): PlanLimits {
  const cfg = getPlanConfigMap()[tier] || getPlanConfigMap().free;
  return { images: cfg.images, videos: cfg.videos };
}

const initialPlans = getPlanConfigMap();

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: { images: initialPlans.free.images, videos: initialPlans.free.videos },
  pro: { images: initialPlans.pro.images, videos: initialPlans.pro.videos },
  ultimate: { images: initialPlans.ultimate.images, videos: initialPlans.ultimate.videos },
};

// Global usage reset timestamp: wishes created before this moment are excluded from current billing usage
export const DEFAULT_USAGE_RESET_ISO = "2026-11-26T09:50:00.000Z";

export function getBillingMonthRange(date: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

export function getEffectiveUsageStart(monthStart: Date, monthEnd: Date): Date {
  const resetIso = process.env.USAGE_RESET_AFTER || DEFAULT_USAGE_RESET_ISO;
  const resetDate = new Date(resetIso);
  if (!Number.isNaN(resetDate.getTime()) && resetDate > monthStart && resetDate < monthEnd) {
    return resetDate;
  }
  return monthStart;
}
