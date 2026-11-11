import "./errors.js";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  AppError,
  type DeleteImpact,
  type DeleteImpactItem,
  type DeleteTarget,
} from "@waitron/shared";
import {
  billPaymentRefunds,
  billPayments,
  devices,
  printerHolders,
  printers,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { endDeviceSessions, sessions } from "@waitron/identity";
import {
  IN_PROGRESS_PAYMENT_STATES,
  cardReaderHolders,
  cardReaders,
  payments,
} from "@waitron/payments";
import { named } from "./delete-impact.js";
import { releaseDevice } from "./device-equipment.js";
import { endReturningRequest, hasReturningRequest } from "./join-requests.js";
import type { TradingContext } from "./trading-context.js";

const orderName = (row: {
  id: string;
  label: string | null;
  orderNumber: number;
}): DeleteTarget => ({
  id: row.id,
  name: row.label ?? `#${row.orderNumber}`,
});

const counted = (key: string, count: number): DeleteImpactItem => ({ key, count, targets: [] });

async function deviceDeleteRules(
  tx: Transaction,
  cfg: TradingContext,
  id: string,
): Promise<DeleteImpact> {
  const [device] = await tx
    .select({
      id: devices.id,
      name: devices.label,
    })
    .from(devices)
    .where(and(eq(devices.id, id), isNull(devices.deletedAt)));
  if (device === undefined) throw new AppError("device.not_found", { deviceId: id });

  const orderColumns = {
    id: workingOrders.id,
    label: workingOrders.label,
    orderNumber: workingOrders.orderNumber,
  };
  const cardOrders = await tx
    .select(orderColumns)
    .from(payments)
    .innerJoin(workingOrders, eq(workingOrders.id, payments.workingOrderId))
    .where(and(eq(payments.deviceId, id), inArray(payments.state, IN_PROGRESS_PAYMENT_STATES)));
  const billOrders = await tx
    .select(orderColumns)
    .from(billPayments)
    .innerJoin(workingOrders, eq(workingOrders.id, billPayments.workingOrderId))
    .where(and(eq(billPayments.deviceId, id), eq(billPayments.state, "pending")));
  const refundOrders = await tx
    .select(orderColumns)
    .from(billPaymentRefunds)
    .innerJoin(billPayments, eq(billPayments.id, billPaymentRefunds.billPaymentId))
    .innerJoin(workingOrders, eq(workingOrders.id, billPayments.workingOrderId))
    .where(and(eq(billPaymentRefunds.deviceId, id), eq(billPaymentRefunds.state, "pending")));
  const unfinished = named(
    "device.payment_in_progress",
    [...cardOrders, ...billOrders, ...refundOrders].map(orderName),
  );

  const openSessions = await tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.deviceId, id), isNull(sessions.endedAt)));
  const heldPrinters = await tx
    .select({ id: printers.id, name: printers.name })
    .from(printerHolders)
    .innerJoin(printers, eq(printers.id, printerHolders.printerId))
    .where(eq(printerHolders.deviceId, id));
  const heldReaders = await tx
    .select({ id: cardReaders.id, name: cardReaders.name })
    .from(cardReaderHolders)
    .innerJoin(cardReaders, eq(cardReaders.id, cardReaderHolders.readerId))
    .where(eq(cardReaderHolders.deviceId, id));
  const returning = await hasReturningRequest(tx, cfg, id);

  const ends: DeleteImpactItem[] = [
    counted("sessions", openSessions.length),
    named("held_printers", heldPrinters),
    named("held_readers", heldReaders),
    counted("join_request", returning ? 1 : 0),
  ];
  return {
    target: { id: device.id, name: device.name },
    refusals:
      unfinished.count === 0
        ? []
        : [{ code: "device.payment_in_progress", params: {}, targets: unfinished.targets }],
    ends: ends.filter((item) => item.count > 0),
    removes: [],
  };
}

export async function readDeviceDeleteImpact(
  tx: Transaction,
  cfg: TradingContext,
  id: string,
): Promise<DeleteImpact> {
  return deviceDeleteRules(tx, cfg, id);
}

/** Disable: switches the device off, ends its sign-ins and releases its holds;
 * `device.not_found` when no device that is not deleted has `id`. Never a hard DELETE: a device is
 * a durable identity. */
export async function disableDevice(tx: Transaction, id: string): Promise<void> {
  const updated = await tx
    .update(devices)
    .set({ active: false })
    .where(and(eq(devices.id, id), isNull(devices.deletedAt)))
    .returning({ id: devices.id });
  if (updated.length === 0) throw new AppError("device.not_found", { deviceId: id });
  await endDeviceSessions(tx, id);
  await releaseDevice(tx, id);
}

export async function deleteDevice(
  tx: Transaction,
  cfg: TradingContext,
  id: string,
): Promise<DeleteImpact> {
  const impact = await deviceDeleteRules(tx, cfg, id);
  if (impact.refusals.length > 0) throw new AppError("device.payment_in_progress", {});
  await disableDevice(tx, id);
  await endReturningRequest(tx, cfg, id);
  return impact;
}
