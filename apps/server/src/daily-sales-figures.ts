import { inArray } from "drizzle-orm";
import { devices, type Transaction } from "@waitron/db";
import {
  computeTopSellers,
  computeDailyClose,
  validatedRangeWindow,
  type CashUp,
  type DailyClose,
  type DailyCloseInput,
} from "@waitron/reporting";
import { addDecimal, decimal, type NodeId } from "@waitron/shared";
import { listOutsidePayments } from "./outside-payments-report.js";

export async function readDailySalesFigures(
  tx: Transaction,
  input: DailyCloseInput & { nodeIds: readonly NodeId[] },
) {
  const close = await computeDailyClose(tx, input);
  const range = { ...input, fromBusinessDay: input.businessDay, toBusinessDay: input.businessDay };
  const topSellers = await computeTopSellers(tx, { ...range, limit: 10 });
  const cash = await namedCashUp(tx, close.cash);
  const outsidePayments = await listOutsidePayments(tx, validatedRangeWindow(range), input.nodeIds);
  return { close, cash, topSellers, closureSummary: summariseClosures(close), outsidePayments };
}

/** A deferred line is a final classification, never money received, so it stays out of `received`. */
export function summariseClosures(close: DailyClose) {
  const cash = close.cash;
  const billsClosed = close.departmentTakings.reduce(
    (total, row) => ({
      count: total.count + row.billsClosed.count,
      total: addDecimal(total.total, row.billsClosed.total),
    }),
    { count: 0, total: decimal("0.00") },
  );
  let deferredPayments = decimal("0.00");
  let received = decimal("0.00");
  for (const line of cash.byOrigin.flatMap((row) => row.byMethod)) {
    if (line.method === "deferred") deferredPayments = addDecimal(deferredPayments, line.amount);
    else received = addDecimal(received, line.amount);
  }
  return { billsClosed, deferredPayments, received };
}

/**
 * The cash-up with each device row's name. Read with no `active` filter, so a device revoked after
 * it took money is still named on the day it took it.
 */
async function namedCashUp(tx: Transaction, cash: CashUp) {
  const ids = cash.byOrigin.flatMap((row) => (row.deviceId === null ? [] : [row.deviceId]));
  const named =
    ids.length === 0
      ? []
      : await tx
          .select({ id: devices.id, label: devices.label })
          .from(devices)
          .where(inArray(devices.id, ids));
  const names = new Map(named.map((row) => [row.id, row.label]));
  return {
    ...cash,
    byOrigin: cash.byOrigin.map((row) => ({
      ...row,
      deviceName: row.deviceId === null ? null : (names.get(row.deviceId) ?? null),
    })),
  };
}
