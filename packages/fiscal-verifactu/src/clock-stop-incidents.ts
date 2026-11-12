import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import { markIncidentHandled, recordIncident } from "@waitron/core";
import { incidents } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, jobOrigin } from "@waitron/shared";
import type { ErrorParams } from "@waitron/shared";

function openCorrected(tx: Transaction) {
  const origin = jobOrigin("dashboard");
  return tx
    .select({ id: incidents.id, detectedAt: incidents.detectedAt })
    .from(incidents)
    .where(
      and(
        eq(incidents.source, origin.source),
        isNull(incidents.deviceId),
        eq(incidents.code, "clock.corrected"),
        isNull(incidents.acknowledgedAt),
      ),
    );
}

/** Records `clock.corrected` at `detectedAt`, first marking any open one handled by the system:
 * every step gets its own alert, which would otherwise fold into the open one. Answers the alert
 * it recorded, for the email duty. */
export async function recordCorrected(
  tx: Transaction,
  input: { detectedAt: Date; params: ErrorParams["clock.corrected"] },
): Promise<{ id: string; params: ErrorParams["clock.corrected"] }> {
  // A step back would otherwise mark the earlier alert handled before it was detected.
  for (const { id, detectedAt } of await openCorrected(tx))
    await markIncidentHandled(tx, {
      id,
      personId: null,
      handledAt: new Date(Math.max(Date.parse(detectedAt), input.detectedAt.getTime())),
    });
  await recordIncident(tx, {
    origin: jobOrigin("dashboard"),
    error: new AppError("clock.corrected", input.params),
    severity: "warning",
    detectedAt: input.detectedAt,
  });
  // Every earlier one was just marked handled, so the open one is this step's.
  const [recorded] = await openCorrected(tx);
  return { id: recorded!.id, params: input.params };
}
