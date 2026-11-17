import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { generateEventWish } from "../services/automation/automation.service";
import { logger } from "../utils/logger";

export async function generateAutomation(req: AuthRequest, res: Response) {
  try {
    const { eventId } = req.body;

    if (!eventId) {
      return res.status(400).json({
        success: false,
        message: "eventId is required",
      });
    }

    const result = await generateEventWish(eventId);

    return res.json(result);
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error({ err: err?.message || error }, "Error generating automation wish");

    return res.status(500).json({
      success: false,
      message: err?.message || "Internal server error",
    });
  }
}


