import {
  currentIncidentsOf,
  markIncidentHandled,
  recordIncident,
  recordIncidentOnce,
} from "@waitron/core";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { AppError, jobOrigin, timeZoneOffsetMinutes } from "@waitron/shared";
import { venueTimeZoneIn } from "./venue-time-zone.js";
import "./errors.js";

const origin = jobOrigin("dashboard");

async function closePriorStartAlert(
  tx: Transaction,
  code:
    | "start.unplanned_stop"
    | "start.selling_unconfirmed"
    | "start.shutdown_paused"
    | "start.shutdown_upload_stalled",
  now: Date,
): Promise<void> {
  const { open } = await currentIncidentsOf(tx, { origin, code });
  if (open !== null)
    await markIncidentHandled(tx, {
      id: open.id,
      personId: null,
      handledAt: new Date(Math.max(open.detectedAt.getTime(), now.getTime())),
    });
}

export async function recordUnconfirmedStart(db: Database, now: Date): Promise<void> {
  const code = "start.selling_unconfirmed";
  await withTransaction(db, async (tx) => {
    await closePriorStartAlert(tx, code, now);
    await recordIncident(tx, {
      origin,
      error: new AppError(code, {}),
      severity: "warning",
      detectedAt: now,
    });
  });
}

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
  const code = "start.unplanned_stop";
  await withTransaction(db, async (tx) => {
    await closePriorStartAlert(tx, code, now);
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

export async function recordShutdownPause(
  db: Database,
  errorCode: string | null,
  now: Date,
): Promise<void> {
  const error =
    errorCode === null
      ? new AppError("start.shutdown_upload_stalled", {})
      : new AppError("start.shutdown_paused", { errorCode });
  await withTransaction(db, async (tx) => {
    await closePriorStartAlert(tx, error.code, now);
    await recordIncident(tx, {
      origin,
      error,
      severity: "warning",
      detectedAt: now,
    });
  });
}
