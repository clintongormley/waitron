import { recordIncidentOnce } from "@waitron/core";
import { withTransaction, type Database } from "@waitron/db";
import { AppError, jobOrigin, timeZoneOffsetMinutes } from "@waitron/shared";
import { venueTimeZoneIn } from "./venue-time-zone.js";
import "./errors.js";

export async function recordUnexpectedStop(
  db: Database,
  heartbeatAt: string,
  now: Date,
): Promise<void> {
  await withTransaction(db, async (tx) =>
    recordIncidentOnce(tx, {
      origin: jobOrigin("dashboard"),
      error: new AppError("start.unplanned_stop", {
        lastRunningAt: heartbeatAt,
        lastRunningOffsetMinutes: timeZoneOffsetMinutes(
          await venueTimeZoneIn(tx),
          new Date(heartbeatAt),
        ),
      }),
      severity: "warning",
      detectedAt: now,
    }),
  );
}
