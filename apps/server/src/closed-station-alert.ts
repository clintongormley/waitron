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
import type { OriginConfig } from "./trading-context.js";
import "./errors.js";

export interface Stranded {
  stationId: string;
  stationName: string;
  /** Dishes and split-off extras left there, in line order. */
  lineIds: readonly string[];
}

/** Record one release that leaves work at closed stations, naming the device that released it:
 * `route.released_at_closed_station` for `released`, `route.waiting_at_closed_station` for work at
 * stations that wait for the pass. An open alert from the same device absorbs later releases. */
export async function raiseReleasedAtClosedStation(
  tx: Transaction,
  cfg: Pick<OriginConfig, "origin">,
  orderId: string,
  at: Date,
  released: readonly Stranded[],
  waiting: readonly Stranded[] = [],
): Promise<void> {
  if (released.length === 0 && waiting.length === 0) return;
  const lines = await tx
    .select({ id: workingOrderLines.id, name: workingOrderLines.name })
    .from(workingOrderLines)
    .where(
      inArray(workingOrderLines.id, [
        ...new Set([...released, ...waiting].flatMap((station) => station.lineIds)),
      ]),
    )
    .orderBy(workingOrderLines.lineNo);
  const [order] = await tx
    .select({ orderNumber: workingOrders.orderNumber, label: workingOrders.label })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  const params = (stranded: readonly Stranded[]) => {
    const lineIds = new Set(stranded.flatMap((station) => station.lineIds));
    return {
      station: [
        ...new Map(stranded.map((entry) => [entry.stationId, entry.stationName])).values(),
      ].join(", "),
      dishes: [
        ...new Set(
          lines.filter((line) => lineIds.has(line.id)).map((line) => line.name || line.id),
        ),
      ].join(", "),
      workingOrderId: orderId,
      orderNumber: order!.orderNumber,
    };
  };
  const record = async (error: AppError) => {
    try {
      await recordIncidentOnce(tx, {
        origin: cfg.origin,
        error,
        severity: "error",
        detectedAt: at,
      });
    } catch (refusal) {
      if (!isRefusal(refusal, ALERT_REFUSALS)) throw refusal;
    }
  };
  if (released.length > 0)
    await record(
      new AppError("route.released_at_closed_station", {
        ...params(released),
        orderLabel: order!.label,
      }),
    );
  if (waiting.length > 0)
    await record(new AppError("route.waiting_at_closed_station", params(waiting)));
}

const ALERT_REFUSALS = [...UNIQUE_VIOLATION, ...NOT_NULL_VIOLATION];
