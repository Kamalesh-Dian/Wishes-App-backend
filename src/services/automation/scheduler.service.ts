import { DateTime } from "luxon";
import Event from "../../models/Event";
import OneDriveConnection from "../../models/OneDriveConnection";
import { syncOneDriveEvents } from "./sync.service";
import { generateEventWish } from "./automation.service";
import { sendWishMail } from "../email/sendWishMail";
import { logger } from "../../utils/logger";

let isRunning = false;

export function isSchedulerRunning(): boolean {
  return isRunning;
}

/**
 * Computes target month and day(s) for "today" in the specified timezone.
 * In non-leap years, if today is Feb 28, Feb 29 events are also targeted
 * so leap-day babies receive their wishes.
 */
export function getTodayTargetDates(tz: string = process.env.DEFAULT_TZ || "Asia/Kolkata"): Array<{ eventMonth: number; eventDay: number }> {
  const now = DateTime.now().setZone(tz);
  const month = now.month;
  const day = now.day;
  const isLeapYear = now.isInLeapYear;

  const targets = [{ eventMonth: month, eventDay: day }];

  // In non-leap years, if today is Feb 28, also include Feb 29
  if (month === 2 && day === 28 && !isLeapYear) {
    targets.push({ eventMonth: 2, eventDay: 29 });
  }

  return targets;
}

/**
 * Recovers events that were left stuck in "generating" or "sending"
 * for more than 15 minutes (e.g. server crash or worker timeout).
 */
export async function recoverStuckEvents(): Promise<number> {
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  const result = await Event.updateMany(
    {
      status: { $in: ["generating", "sending"] },
      updatedAt: { $lt: fifteenMinutesAgo },
    },
    {
      $set: {
        status: "pending",
        lastError: "Recovered from stuck state (>15 min)",
      },
    }
  );

  if (result.modifiedCount > 0) {
    logger.warn({ count: result.modifiedCount }, "Recovered stuck event(s) back to pending");
  }
  return result.modifiedCount;
}

export async function generateTodayEvents(): Promise<number> {
  if (isRunning) {
    logger.info("Scheduler job is already executing. Skipping concurrent run.");
    return 0;
  }

  isRunning = true;

  try {
    // 1. Recover any events stuck from crashes / timeouts
    try {
      await recoverStuckEvents();
    } catch (recoverErr) {
      logger.error({ err: recoverErr }, "Error recovering stuck events");
    }

    // 2. Sync connected OneDrive Excel sheets before processing events
    try {
      const activeConnections = await OneDriveConnection.find({ syncEnabled: true });
      for (const connection of activeConnections) {
        if (connection.accessToken) {
          try {
            logger.info({ fileName: connection.fileName }, "Auto-syncing OneDrive file");
            await syncOneDriveEvents(connection.userId, connection.accessToken);
          } catch (syncErr: unknown) {
            const err = syncErr as { message?: string };
            logger.error({ fileName: connection.fileName, err: err?.message || syncErr }, "Auto-sync failed");
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Error during OneDrive auto-sync");
    }

    const targetDates = getTodayTargetDates();
    const dateQuery = targetDates.length === 1
      ? { eventMonth: targetDates[0].eventMonth, eventDay: targetDates[0].eventDay }
      : {
          $or: targetDates.map((td) => ({
            eventMonth: td.eventMonth,
            eventDay: td.eventDay,
          })),
        };

    let processedCount = 0;

    // 3. Atomic claim loop with recovery & retry logic
    while (true) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

      const event = await Event.findOneAndUpdate(
        {
          $and: [
            dateQuery,
            {
              $or: [
                // Fresh pending events
                { status: "pending" },
                // Failed retry 1: wait 5 minutes before attempt 2
                {
                  status: "failed",
                  attempts: 1,
                  updatedAt: { $lt: fiveMinutesAgo },
                },
                // Failed retry 2: wait 15 minutes before attempt 3
                {
                  status: "failed",
                  attempts: 2,
                  updatedAt: { $lt: fifteenMinutesAgo },
                },
                // Failed with 0 attempts (edge case)
                {
                  status: "failed",
                  attempts: { $lt: 1 },
                },
              ],
            },
          ],
        },
        {
          $set: {
            status: "generating",
            claimedAt: new Date(),
          },
          $inc: {
            attempts: 1,
          },
        },
        { new: true }
      );

      if (!event) {
        break; // No more eligible events for today
      }

      processedCount++;

      try {
        logger.info({ eventId: event._id, name: event.name, attempt: event.attempts }, "Processing scheduled event");

        const result = await generateEventWish(event._id.toString());
        logger.debug({ eventId: event._id }, "Image generated successfully for event");

        // Mark as sending
        await Event.findByIdAndUpdate(event._id, { status: "sending" });

        const imageUrl = result.event.generatedWishImage;
        if (!imageUrl) {
          throw new Error("Generated image URL is missing");
        }

        await sendWishMail({
          to: event.email,
          name: event.name,
          occasion: event.occasion,
          imageUrl,
          customMessage: event.customMessage,
        });

        await Event.findByIdAndUpdate(event._id, {
          status: "sent",
          lastError: undefined,
        });
        logger.info({ eventId: event._id, name: event.name }, "Event completed successfully");
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error);
        logger.error({ eventId: event._id, name: event.name, err: errMessage }, "Automation failed for event");

        if (event.attempts >= 3) {
          logger.error(
            { eventId: event._id, name: event.name, attempts: event.attempts },
            "[CRITICAL ALERT] Event reached maximum attempts (3/3). Marked permanently failed.",
          );
          await Event.findByIdAndUpdate(event._id, {
            status: "failed",
            lastError: `Max retries exceeded: ${errMessage}`,
          });
        } else {
          logger.warn(
            { eventId: event._id, name: event.name, attempts: event.attempts, err: errMessage },
            "Event failed, scheduled for exponential backoff retry",
          );
          await Event.findByIdAndUpdate(event._id, {
            status: "failed",
            lastError: errMessage,
          });
        }
      }
    }

    return processedCount;
  } finally {
    isRunning = false;
  }
}
