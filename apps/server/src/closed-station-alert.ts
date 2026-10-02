import { eq, inArray } from "drizzle-orm";
import {
  isRefusal,
  NOT_NULL_VIOLATION,
  TRIGGER_ABORT,
  UNIQUE_VIOLATION,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { recordIncidentOnce } from "@waitron/core";
import { AppError } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

export interface Stranded {
  stationId: string;
  stationName: string;
  /** Dishes and split-off extras left there, in line order. */
  lineIds: readonly string[];
}

/** Record one release that leaves work at a closed station. An alert refusal cannot fail the
 * release; no logger is available on this path. An open alert on this till absorbs later releases. */
export async function raiseReleasedAtClosedStation(
  tx: Transaction,
  cfg: Pick<TillConfig, "tillId">,
  orderId: string,
  at: Date,
  stranded: readonly Stranded[],
): Promise<void> {
  if (stranded.length === 0) return;
  try {
    const lineIds = [...new Set(stranded.flatMap((station) => station.lineIds))];
    const lines = await tx
      .select({ id: workingOrderLines.id, name: workingOrderLines.name })
      .from(workingOrderLines)
      .where(inArray(workingOrderLines.id, lineIds))
      .orderBy(workingOrderLines.lineNo);
    const [order] = await tx
      .select({ orderNumber: workingOrders.orderNumber, label: workingOrders.label })
      .from(workingOrders)
      .where(eq(workingOrders.id, orderId));
    await recordIncidentOnce(tx, {
      tillId: cfg.tillId,
      error: new AppError("route.released_at_closed_station", {
        station: [
          ...new Map(stranded.map((entry) => [entry.stationId, entry.stationName])).values(),
        ].join(", "),
        dishes: [...new Set(lines.map((line) => line.name || line.id))].join(", "),
        workingOrderId: orderId,
        orderNumber: order!.orderNumber,
        orderLabel: order!.label,
      }),
      severity: "error",
      detectedAt: at,
    });
  } catch (error) {
    if (!isRefusal(error, ALERT_REFUSALS)) throw error;
  }
}

const ALERT_REFUSALS = [...TRIGGER_ABORT, ...UNIQUE_VIOLATION, ...NOT_NULL_VIOLATION];
