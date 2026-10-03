import { eq, inArray } from "drizzle-orm";
import {
  isRefusal,
  NOT_NULL_VIOLATION,
  UNIQUE_VIOLATION,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { recordIncidentOnce } from "@waitron/core";
import { AppError } from "@waitron/shared";
import type { OriginConfig } from "./till-config.js";
import "./errors.js";

export interface Stranded {
  stationId: string;
  stationName: string;
  /** Dishes and split-off extras left there, in line order. */
  lineIds: readonly string[];
}

/** Record one release that leaves work at a closed station, naming the device that released it. An
 * open alert from the same device absorbs later releases. */
export async function raiseReleasedAtClosedStation(
  tx: Transaction,
  cfg: Pick<OriginConfig, "origin">,
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
      origin: cfg.origin,
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

const ALERT_REFUSALS = [...UNIQUE_VIOLATION, ...NOT_NULL_VIOLATION];
