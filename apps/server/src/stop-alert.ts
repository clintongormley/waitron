import {
  currentIncidentsOf,
  markIncidentHandled,
  recordIncident,
  recordIncidentOnce,
} from "@waitron/core";
import { withTransaction, type Database } from "@waitron/db";
import { AppError, jobOrigin, timeZoneOffsetMinutes } from "@waitron/shared";
import { venueTimeZoneIn } from "./venue-time-zone.js";
import "./errors.js";

export async function recordReplacement(db: Database, now: Date): Promise<void> {
  await withTransaction(db, (tx) =>
    recordIncidentOnce(tx, {
      origin: jobOrigin("dashboard"),
      error: new AppError("start.replaced", {}),
      severity: "error",
      detectedAt: now,
    }),
  );
}

export async function recordUnexpectedStop(
  db: Database,
  heartbeatAt: string,
  now: Date,
): Promise<void> {
  const origin = jobOrigin("dashboard");
  const code = "start.unplanned_stop";
  await withTransaction(db, async (tx) => {
    const { open } = await currentIncidentsOf(tx, { origin, code });
    if (open !== null) {
      await markIncidentHandled(tx, {
        id: open.id,
        personId: null,
        handledAt: new Date(Math.max(open.detectedAt.getTime(), now.getTime())),
      });
    }
    await recordIncident(tx, {
      origin,
      error: new AppError(code, {
        lastRunningAt: heartbeatAt,
        lastRunningOffsetMinutes: timeZoneOffsetMinutes(
          await venueTimeZoneIn(tx),
          new Date(heartbeatAt),
        ),
      }),
      severity: "warning",
      detectedAt: now,
    });
  });
}
