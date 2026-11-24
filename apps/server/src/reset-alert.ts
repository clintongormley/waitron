import "./errors.js";
import { and, eq, sql } from "drizzle-orm";
import { incidents, type Transaction } from "@waitron/db";
import { recordIncidentOnce } from "@waitron/core";
import { AppError, jobOrigin } from "@waitron/shared";

const SET_ASIDE_ALERT = "chain.set_aside_on_reset";

/** Whether this order's set-aside alert was raised, handled or not. */
async function alertRaisedFor(tx: Transaction, orderId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: incidents.id })
    .from(incidents)
    .where(
      and(
        eq(incidents.code, SET_ASIDE_ALERT),
        sql`json_extract(${incidents.params}, '$.orderId') = ${orderId}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Raises `chain.set_aside_on_reset` for an acknowledged order once, keyed by the order, so a
 * retried acknowledgement raises no second alert even after the first was handled. An open alert
 * of the same code absorbs another order's: the incidents table keeps one open alert per code and
 * origin (`incidents_open_dedup`), whichever writer inserts it.
 */
export async function raiseSetAsideOnReset(
  tx: Transaction,
  args: {
    readonly nodeId: string;
    readonly orderId: string;
    readonly recordsMissing: boolean;
    readonly at: Date;
  },
): Promise<void> {
  if (await alertRaisedFor(tx, args.orderId)) return;
  await recordIncidentOnce(tx, {
    origin: jobOrigin("dashboard"),
    error: new AppError(SET_ASIDE_ALERT, {
      nodeId: args.nodeId,
      orderId: args.orderId,
      recordsMissing: args.recordsMissing,
    }),
    severity: "warning",
    detectedAt: args.at,
  });
}
