import { describe, it, expect, afterEach } from "vitest";
import { DateTime } from "luxon";
import {
  getAutomationConfig,
  parseSendTime,
  isAfterScheduledSendTime,
} from "../config/automation";

describe("Two-Automation Schedule Configuration", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("loads safe defaults for Excel sync and 09:00 wish sending", () => {
    delete process.env.EXCEL_SYNC_ENABLED;
    delete process.env.EXCEL_SYNC_CRON;
    delete process.env.AUTOMATION_SEND_ENABLED;
    delete process.env.AUTOMATION_SEND_TIME;
    delete process.env.AUTOMATION_SEND_CHECK_CRON;
    delete process.env.DEFAULT_TZ;

    const cfg = getAutomationConfig();
    expect(cfg.excelSyncEnabled).toBe(true);
    expect(cfg.excelSyncCron).toBe("*/15 * * * *");
    expect(cfg.sendEnabled).toBe(true);
    expect(cfg.sendTime).toBe("09:00");
    expect(cfg.sendCheckCron).toBe("*/5 * * * *");
    expect(cfg.timezone).toBe("Asia/Kolkata");
  });

  it("reads custom Excel sync cron and send time from env", () => {
    process.env.EXCEL_SYNC_CRON = "0 * * * *";
    process.env.AUTOMATION_SEND_TIME = "10:30";
    process.env.DEFAULT_TZ = "America/New_York";

    const cfg = getAutomationConfig();
    expect(cfg.excelSyncCron).toBe("0 * * * *");
    expect(cfg.sendTime).toBe("10:30");
    expect(cfg.timezone).toBe("America/New_York");
  });

  it("gates sending until the configured local send time is reached", () => {
    const before = DateTime.fromISO("2026-11-26T08:59:00", { zone: "Asia/Kolkata" });
    const exact = DateTime.fromISO("2026-11-26T09:00:00", { zone: "Asia/Kolkata" });
    const after = DateTime.fromISO("2026-11-26T14:15:00", { zone: "Asia/Kolkata" });

    expect(isAfterScheduledSendTime(before, "09:00", "Asia/Kolkata")).toBe(false);
    expect(isAfterScheduledSendTime(exact, "09:00", "Asia/Kolkata")).toBe(true);
    expect(isAfterScheduledSendTime(after, "09:00", "Asia/Kolkata")).toBe(true);
  });

  it("falls back to 09:00 when send time format is invalid", () => {
    expect(parseSendTime("invalid")).toEqual({ hour: 9, minute: 0 });
    expect(parseSendTime("25:99")).toEqual({ hour: 9, minute: 0 });
    expect(parseSendTime("14:45")).toEqual({ hour: 14, minute: 45 });
  });
});
