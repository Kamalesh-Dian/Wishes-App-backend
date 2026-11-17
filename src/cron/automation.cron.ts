import cron from "node-cron";
import { generateTodayEvents, isSchedulerRunning } from "../services/automation/scheduler.service";
import { logger } from "../utils/logger";

export function startAutomationCron() {
  logger.info("Automation cron scheduler initialized (runs every 5 minutes)");

  cron.schedule("*/5 * * * *", async () => {
    if (isSchedulerRunning()) {
      logger.info("Automation cron skipped: a previous job is still running.");
      return;
    }

    logger.debug("Automation cron job triggered");

    try {
      const count = await generateTodayEvents();
      logger.info({ processedEvents: count }, "Automation cron cycle completed");
    } catch (error) {
      logger.error({ err: error }, "Automation cron cycle error");
    }
  });
}
