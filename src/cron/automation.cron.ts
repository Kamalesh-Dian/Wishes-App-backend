import cron from "node-cron";
import {
  generateTodayEvents,
  isSchedulerRunning,
  syncAllOneDriveEvents,
  isExcelSyncRunning,
} from "../services/automation/scheduler.service";
import {
  getAutomationConfig,
  isAfterScheduledSendTime,
} from "../config/automation";
import { logger } from "../utils/logger";

export function startAutomationCron() {
  const config = getAutomationConfig();

  // Automation 1: Excel / OneDrive Event Sync Cron
  if (config.excelSyncEnabled) {
    logger.info(
      { cron: config.excelSyncCron, timezone: config.timezone },
      "Automation 1 initialized: Excel/OneDrive event sync scheduler"
    );

    cron.schedule(config.excelSyncCron, async () => {
      if (isExcelSyncRunning()) {
        logger.info("Excel sync cron skipped: a previous sync is still running.");
        return;
      }

      logger.debug("Excel sync cron job triggered");
      try {
        const synced = await syncAllOneDriveEvents();
        logger.info({ syncedConnections: synced }, "Excel/OneDrive sync cycle completed");
      } catch (error) {
        logger.error({ err: error }, "Excel/OneDrive sync cycle error");
      }
    });
  } else {
    logger.info("Automation 1 (Excel/OneDrive sync) is disabled via EXCEL_SYNC_ENABLED=false");
  }

  // Automation 2: Scheduled Wish Image/Video Generation & Sending Cron
  if (config.sendEnabled) {
    logger.info(
      {
        sendTime: config.sendTime,
        checkCron: config.sendCheckCron,
        timezone: config.timezone,
      },
      "Automation 2 initialized: Scheduled wish generation & delivery"
    );

    cron.schedule(config.sendCheckCron, async () => {
      if (!isAfterScheduledSendTime()) {
        logger.debug(
          { configuredSendTime: config.sendTime, timezone: config.timezone },
          "Wish dispatch skipped: waiting for configured send time"
        );
        return;
      }

      if (isSchedulerRunning()) {
        logger.info("Wish dispatch cron skipped: a previous job is still running.");
        return;
      }

      logger.debug("Wish dispatch cron job triggered");

      try {
        const count = await generateTodayEvents();
        logger.info({ processedEvents: count }, "Wish dispatch cron cycle completed");
      } catch (error) {
        logger.error({ err: error }, "Wish dispatch cron cycle error");
      }
    });
  } else {
    logger.info("Automation 2 (Wish dispatch) is disabled via AUTOMATION_SEND_ENABLED=false");
  }
}
