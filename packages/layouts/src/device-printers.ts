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

/**
 * The printers a device at `locationId` on this profile may use for `role`, in list order: listed,
 * active, and at the device's own location.
 */
async function usablePrinters(
  tx: Transaction,
  profileId: string,
  locationId: string,
  role: PrinterRole,
): Promise<PrinterChoice[]> {
  return tx
    .select({ id: printers.id, name: printers.name })
    .from(deviceProfilePrinters)
    .innerJoin(printers, eq(printers.id, deviceProfilePrinters.printerId))
    .where(
      and(
        eq(deviceProfilePrinters.deviceProfileId, profileId),
        eq(deviceProfilePrinters.role, role),
        eq(printers.active, true),
        eq(printers.locationId, locationId),
      ),
    )
    .orderBy(asc(deviceProfilePrinters.position));
}

export async function printerChoices(
  tx: Transaction,
  profileId: string,
  locationId: string,
): Promise<{ receipt: PrinterChoice[]; paymentSlip: PrinterChoice[] }> {
  return {
    receipt: await usablePrinters(tx, profileId, locationId, "receipt"),
    paymentSlip: await usablePrinters(tx, profileId, locationId, "payment_slip"),
  };
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
 * Every device on the profile whose current receipt or slip printer is no longer usable moves to
 * the first usable one, or to none. A device holding none keeps none. A printer deactivated outside
 * this call stays stored until then.
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
  for (const device of onProfile) {
    const choices = await printerChoices(tx, profileId, device.locationId);
    const settle = (current: string | null, usable: PrinterChoice[]) =>
      current === null || usable.some((p) => p.id === current) ? current : (usable[0]?.id ?? null);
    const receiptPrinterId = settle(device.receiptPrinterId, choices.receipt);
    const paymentSlipPrinterId = settle(device.paymentSlipPrinterId, choices.paymentSlip);
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
    const usable = await usablePrinters(tx, device.profileId, device.locationId, role);
    if (!usable.some((p) => p.id === printerId)) return { ok: false, field };
  }
  await tx
    .update(devices)
    .set(role === "receipt" ? { receiptPrinterId: printerId } : { paymentSlipPrinterId: printerId })
    .where(eq(devices.id, deviceId));
  return { ok: true };
}
