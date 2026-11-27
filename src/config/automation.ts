import { DateTime } from "luxon";

export interface AutomationScheduleConfig {
  timezone: string;
  // Automation 1: Excel / OneDrive event sync
  excelSyncEnabled: boolean;
  excelSyncCron: string;
  // Automation 2: Scheduled image/video generation & sending
  sendEnabled: boolean;
  sendTime: string; // HH:mm (24-hour format, e.g. "09:00")
  sendCheckCron: string;
}

export function getAutomationConfig(): AutomationScheduleConfig {
  return {
    timezone: process.env.DEFAULT_TZ?.trim() || "Asia/Kolkata",
    excelSyncEnabled: process.env.EXCEL_SYNC_ENABLED !== "false",
    excelSyncCron: process.env.EXCEL_SYNC_CRON?.trim() || "*/15 * * * *",
    sendEnabled: process.env.AUTOMATION_SEND_ENABLED !== "false",
    sendTime: process.env.AUTOMATION_SEND_TIME?.trim() || "09:00",
    sendCheckCron: process.env.AUTOMATION_SEND_CHECK_CRON?.trim() || "*/5 * * * *",
  };
}

/**
 * Parses an "HH:mm" string into hour (0-23) and minute (0-59).
 * Falls back to 09:00 if invalid.
 */
export function parseSendTime(sendTime: string): { hour: number; minute: number } {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(sendTime.trim());
  if (!match) {
    return { hour: 9, minute: 0 };
  }
  return {
    hour: parseInt(match[1], 10),
    minute: parseInt(match[2], 10),
  };
}

/**
 * Returns true if the current time in the configured timezone is at or after
 * the configured AUTOMATION_SEND_TIME (e.g. 09:00).
 */
export function isAfterScheduledSendTime(
  now: DateTime = DateTime.now(),
  sendTime?: string,
  timezone?: string
): boolean {
  const cfg = getAutomationConfig();
  const tz = timezone || cfg.timezone;
  const target = parseSendTime(sendTime || cfg.sendTime);
  const localNow = now.setZone(tz);
  const currentMinutes = localNow.hour * 60 + localNow.minute;
  const targetMinutes = target.hour * 60 + target.minute;
  return currentMinutes >= targetMinutes;
}
