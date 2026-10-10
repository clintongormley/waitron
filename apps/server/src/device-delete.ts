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
  deviceApprovedProfiles,
  deviceMadeHereStations,
  deviceProfiles,
  devices,
  kitchenStations,
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
  deviceCardReaders,
  payments,
} from "@waitron/payments";
import { named } from "./delete-impact.js";
import { releaseDevice } from "./device-equipment.js";
import { endReturningRequest, hasReturningRequest } from "./join-requests.js";
import { VENUE_SERVICE } from "./modules.js";
import type { TillConfig } from "./till-config.js";

const orderName = (row: {
  id: string;
  label: string | null;
  orderNumber: number;
}): DeleteTarget => ({
  id: row.id,
  name: row.label ?? `#${row.orderNumber}`,
});

const counted = (key: string, count: number): DeleteImpactItem => ({ key, count, targets: [] });

/** The impact read and the delete both call this, so the delete acts on exactly what it reports. */
async function deviceDeleteRules(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
): Promise<DeleteImpact> {
  const [device] = await tx
    .select({
      id: devices.id,
      name: devices.label,
      receiptPrinterId: devices.receiptPrinterId,
      paymentSlipPrinterId: devices.paymentSlipPrinterId,
      cashDrawerPrinterId: devices.cashDrawerPrinterId,
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

  const choiceIds = [
    device.receiptPrinterId,
    device.paymentSlipPrinterId,
    device.cashDrawerPrinterId,
  ].filter((printerId): printerId is string => printerId !== null);
  const chosenPrinters =
    choiceIds.length === 0
      ? []
      : await tx
          .select({ id: printers.id, name: printers.name })
          .from(printers)
          .where(inArray(printers.id, choiceIds));
  const madeHere = await tx
    .select({ id: kitchenStations.id, name: kitchenStations.name })
    .from(deviceMadeHereStations)
    .innerJoin(kitchenStations, eq(kitchenStations.id, deviceMadeHereStations.stationId))
    .where(eq(deviceMadeHereStations.deviceId, id));
  const approved = await tx
    .select({ id: deviceProfiles.id, name: deviceProfiles.name })
    .from(deviceApprovedProfiles)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, deviceApprovedProfiles.deviceProfileId))
    .where(eq(deviceApprovedProfiles.deviceId, id));
  const chosenReader = await tx
    .select({ id: cardReaders.id, name: cardReaders.name })
    .from(deviceCardReaders)
    .innerJoin(cardReaders, eq(cardReaders.id, deviceCardReaders.readerId))
    .where(eq(deviceCardReaders.deviceId, id));
  const kitchenScreens = await VENUE_SERVICE.countDeviceKitchenScreens(tx, id);

  const ends: DeleteImpactItem[] = [
    counted("sessions", openSessions.length),
    named("held_printers", heldPrinters),
    named("held_readers", heldReaders),
    counted("join_request", returning ? 1 : 0),
  ];
  const removes: DeleteImpactItem[] = [
    named("printer_choices", chosenPrinters),
    named("made_here_stations", madeHere),
    named("approved_profiles", approved),
    named("card_reader", chosenReader),
    counted("kitchen_screens", kitchenScreens),
  ];
  return {
    target: { id: device.id, name: device.name },
    refusals:
      unfinished.count === 0
        ? []
        : [{ code: "device.payment_in_progress", params: {}, targets: unfinished.targets }],
    ends: ends.filter((item) => item.count > 0),
    removes: removes.filter((item) => item.count > 0),
  };
}

/** What deleting the device would refuse, end and remove now; `device.not_found` once it is
 * deleted. */
export async function readDeviceDeleteImpact(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
): Promise<DeleteImpact> {
  return deviceDeleteRules(tx, cfg, id);
}

/**
 * Recomputes the impact on the caller's transaction and, unless a payment is in progress on the
 * device, acts on it: ends its sign-ins, holds and request to come back, removes its settings and
 * kitchen screens, and keeps the row, switched off, marked deleted, its token and printer choices
 * cleared.
 */
export async function deleteDevice(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  now = new Date(),
): Promise<DeleteImpact> {
  const impact = await deviceDeleteRules(tx, cfg, id);
  if (impact.refusals.length > 0) throw new AppError("device.payment_in_progress", {});
  await endDeviceSessions(tx, id);
  await releaseDevice(tx, id);
  await endReturningRequest(tx, cfg, id);
  await tx.delete(deviceMadeHereStations).where(eq(deviceMadeHereStations.deviceId, id));
  await tx.delete(deviceApprovedProfiles).where(eq(deviceApprovedProfiles.deviceId, id));
  await tx.delete(deviceCardReaders).where(eq(deviceCardReaders.deviceId, id));
  await VENUE_SERVICE.removeDeviceKitchenScreens(tx, id);
  await tx
    .update(devices)
    .set({
      active: false,
      deletedAt: now.toISOString(),
      tokenHash: "",
      receiptPrinterId: null,
      paymentSlipPrinterId: null,
      cashDrawerPrinterId: null,
    })
    .where(and(eq(devices.id, id), isNull(devices.deletedAt)));
  return impact;
}
