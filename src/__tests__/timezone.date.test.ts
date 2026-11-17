import { describe, it, expect, vi, afterEach } from "vitest";
import { Settings, DateTime } from "luxon";
import { getTodayTargetDates } from "../services/automation/scheduler.service";

describe("Timezones & Leap Year Date Handling (Item 11)", () => {
  afterEach(() => {
    // Reset any frozen time
    Settings.now = () => Date.now();
  });

  it("should compute today's date in specified timezone", () => {
    // Freeze time at 2026-08-15T22:30:00Z
    // In UTC: Aug 15
    // In Asia/Kolkata (+05:30): Aug 16, 04:00 AM
    Settings.now = () => new Date("2026-08-15T22:30:00Z").getTime();

    const kolkataTargets = getTodayTargetDates("Asia/Kolkata");
    expect(kolkataTargets).toEqual([{ eventMonth: 8, eventDay: 16 }]);

    const nyTargets = getTodayTargetDates("America/New_York");
    expect(nyTargets).toEqual([{ eventMonth: 8, eventDay: 15 }]);
  });

  it("should include Feb 29 on Feb 28 in a non-leap year (e.g. 2026)", () => {
    // Freeze time on Feb 28, 2026 (non-leap year)
    Settings.now = () => new Date("2026-02-28T12:00:00Z").getTime();

    const targets = getTodayTargetDates("UTC");
    expect(targets).toEqual([
      { eventMonth: 2, eventDay: 28 },
      { eventMonth: 2, eventDay: 29 },
    ]);
  });

  it("should NOT include Feb 29 on Feb 28 in a leap year (e.g. 2028)", () => {
    // Freeze time on Feb 28, 2028 (leap year)
    Settings.now = () => new Date("2028-02-28T12:00:00Z").getTime();

    const targets = getTodayTargetDates("UTC");
    expect(targets).toEqual([{ eventMonth: 2, eventDay: 28 }]);
  });

  it("should target Feb 29 normally on Feb 29 in a leap year (e.g. 2028)", () => {
    // Freeze time on Feb 29, 2028 (leap year)
    Settings.now = () => new Date("2028-02-29T12:00:00Z").getTime();

    const targets = getTodayTargetDates("UTC");
    expect(targets).toEqual([{ eventMonth: 2, eventDay: 29 }]);
  });
});
