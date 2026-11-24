export type PlanTier = "free" | "pro" | "ultimate";

export interface PlanLimits {
  images: number;
  videos: number;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: { images: 5, videos: 0 },
  pro: { images: 40, videos: 10 },
  ultimate: { images: 75, videos: 25 },
};

export function getBillingMonthRange(date: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}
