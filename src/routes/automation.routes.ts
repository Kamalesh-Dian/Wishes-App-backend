import { Router, Response, NextFunction } from "express";
import { auth, AuthRequest } from "../middleware/auth";
import { generateTodayEvents } from "../services/automation/scheduler.service";
import { logger } from "../utils/logger";

const router = Router();

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  const adminUids = (process.env.ADMIN_UIDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const uid = req.user?.uid;
  if (!uid || !adminUids.includes(uid)) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Admin access required",
    });
  }
  next();
};

router.post("/run", auth, requireAdmin, async (_req, res) => {
  try {
    const count = await generateTodayEvents();

    res.json({
      success: true,
      processed: count,
    });
  } catch (error) {
    logger.error({ err: error }, "Automation run error");

    res.status(500).json({
      success: false,
      message: "Failed to run automation",
    });
  }
});

export default router;
