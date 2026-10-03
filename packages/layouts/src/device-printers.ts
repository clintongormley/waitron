import { deviceProfilePrinters, devices, printers } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { and, asc, eq } from "drizzle-orm";

export type PrinterRole = "receipt" | "payment_slip";

export type ProfilePrinterLists = { receiptPrinterIds: string[]; paymentSlipPrinterIds: string[] };

export type PrinterChoice = { id: string; name: string };

/** The device field a refused choice names, so the caller can report it. */
export type DevicePrinterField = "receiptPrinterId" | "paymentSlipPrinterId";

export type ChooseDevicePrinterResult = { ok: true } | { ok: false; field: DevicePrinterField };

const FIELD: Record<PrinterRole, DevicePrinterField> = {
  receipt: "receiptPrinterId",
  payment_slip: "paymentSlipPrinterId",
};

export async function readProfilePrinterLists(
  tx: Transaction,
  profileId: string,
): Promise<ProfilePrinterLists> {
  const rows = await tx
    .select({ printerId: deviceProfilePrinters.printerId, role: deviceProfilePrinters.role })
    .from(deviceProfilePrinters)
    .where(eq(deviceProfilePrinters.deviceProfileId, profileId))
    .orderBy(asc(deviceProfilePrinters.position));
  return {
    receiptPrinterIds: rows.filter((r) => r.role === "receipt").map((r) => r.printerId),
    paymentSlipPrinterIds: rows.filter((r) => r.role === "payment_slip").map((r) => r.printerId),
  };
}

/**
 * Replaces both lists, then moves each of the profile's devices off a printer the new lists no
 * longer offer it. Delete-then-insert is safe because nothing references `device_profile_printers`.
 */
export async function setProfilePrinterLists(
  tx: Transaction,
  profileId: string,
  lists: ProfilePrinterLists,
): Promise<void> {
  await tx
    .delete(deviceProfilePrinters)
    .where(eq(deviceProfilePrinters.deviceProfileId, profileId));
  const rows = [
    ...lists.receiptPrinterIds.map((printerId, position) => ({
      deviceProfileId: profileId,
      printerId,
      role: "receipt" as const,
      position,
    })),
    ...lists.paymentSlipPrinterIds.map((printerId, position) => ({
      deviceProfileId: profileId,
      printerId,
      role: "payment_slip" as const,
      position,
    })),
  ];
  if (rows.length > 0) await tx.insert(deviceProfilePrinters).values(rows);
  await resettleDevicesOnProfile(tx, profileId);
}

type ListedPrinter = PrinterChoice & { role: PrinterRole; active: boolean };

/** Both of the profile's lists, in list order, as offered at `locationId`, switched-off printers included. */
async function listedAt(
  tx: Transaction,
  profileId: string,
  locationId: string,
): Promise<ListedPrinter[]> {
  return tx
    .select({
      id: printers.id,
      name: printers.name,
      role: deviceProfilePrinters.role,
      active: printers.active,
    })
    .from(deviceProfilePrinters)
    .innerJoin(printers, eq(printers.id, deviceProfilePrinters.printerId))
    .where(
      and(
        eq(deviceProfilePrinters.deviceProfileId, profileId),
        eq(printers.locationId, locationId),
      ),
    )
    .orderBy(asc(deviceProfilePrinters.position));
}

/** The printers a device may newly choose for `role`: listed, at its location, and switched on. */
function usable(listed: ListedPrinter[], role: PrinterRole): PrinterChoice[] {
  return listed.filter((p) => p.role === role && p.active).map(({ id, name }) => ({ id, name }));
}

export async function printerChoices(
  tx: Transaction,
  profileId: string,
  locationId: string,
): Promise<{ receipt: PrinterChoice[]; paymentSlip: PrinterChoice[] }> {
  const listed = await listedAt(tx, profileId, locationId);
  return { receipt: usable(listed, "receipt"), paymentSlip: usable(listed, "payment_slip") };
}

export async function firstUsablePrinters(
  tx: Transaction,
  profileId: string,
  locationId: string,
): Promise<{ receiptPrinterId: string | null; paymentSlipPrinterId: string | null }> {
  const choices = await printerChoices(tx, profileId, locationId);
  return {
    receiptPrinterId: choices.receipt[0]?.id ?? null,
    paymentSlipPrinterId: choices.paymentSlip[0]?.id ?? null,
  };
}

/**
 * Every device on the profile whose current receipt or slip printer is no longer listed for that
 * role at its location moves to the first listed printer there that is switched on, or to none. A
 * switched-off printer that is still listed keeps its devices, and a device holding none keeps none.
 */
export async function resettleDevicesOnProfile(tx: Transaction, profileId: string): Promise<void> {
  const onProfile = await tx
    .select({
      id: devices.id,
      locationId: devices.locationId,
      receiptPrinterId: devices.receiptPrinterId,
      paymentSlipPrinterId: devices.paymentSlipPrinterId,
    })
    .from(devices)
    .where(eq(devices.deviceProfileId, profileId));
  const byLocation = new Map<string, ListedPrinter[]>();
  for (const device of onProfile) {
    let listed = byLocation.get(device.locationId);
    if (listed === undefined) {
      listed = await listedAt(tx, profileId, device.locationId);
      byLocation.set(device.locationId, listed);
    }
    const settle = (current: string | null, role: PrinterRole) =>
      current === null || listed.some((p) => p.role === role && p.id === current)
        ? current
        : (usable(listed, role)[0]?.id ?? null);
    const receiptPrinterId = settle(device.receiptPrinterId, "receipt");
    const paymentSlipPrinterId = settle(device.paymentSlipPrinterId, "payment_slip");
    if (
      receiptPrinterId !== device.receiptPrinterId ||
      paymentSlipPrinterId !== device.paymentSlipPrinterId
    ) {
      await tx
        .update(devices)
        .set({ receiptPrinterId, paymentSlipPrinterId })
        .where(eq(devices.id, device.id));
    }
  }
}

/**
 * Sets one of a device's current printers. `null` turns that kind of printing off for the device;
 * any other printer must be usable for it. A refusal is returned rather than thrown because its
 * code belongs to the caller's surface.
 */
export async function chooseDevicePrinter(
  tx: Transaction,
  deviceId: string,
  role: PrinterRole,
  printerId: string | null,
): Promise<ChooseDevicePrinterResult> {
  const field = FIELD[role];
  const [device] = await tx
    .select({ profileId: devices.deviceProfileId, locationId: devices.locationId })
    .from(devices)
    .where(eq(devices.id, deviceId));
  if (device === undefined) return { ok: false, field };
  if (printerId !== null) {
    const listed = await listedAt(tx, device.profileId, device.locationId);
    if (!usable(listed, role).some((p) => p.id === printerId)) return { ok: false, field };
  }
  await tx
    .update(devices)
    .set(role === "receipt" ? { receiptPrinterId: printerId } : { paymentSlipPrinterId: printerId })
    .where(eq(devices.id, deviceId));
  return { ok: true };
}
