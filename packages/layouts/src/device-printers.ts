import "./errors.js";
import { deviceProfilePrinters, printers } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import { refuseDeletedPrinters, settleProfilePrinterDevices } from "./device-equipment.js";

export type PrinterRole = "receipt" | "payment_slip";

/** Every role a profile lists printers for; a cash drawer is never chosen through `PrinterRole`. */
export type ProfilePrinterRole = PrinterRole | "cash_drawer";

/** Each role's list in display order and its default, which is on that list or `null` for none. */
export type ProfilePrinterLists = {
  receiptPrinterIds: string[];
  paymentSlipPrinterIds: string[];
  cashDrawerPrinterIds: string[];
  receiptPrinterDefaultId: string | null;
  paymentSlipPrinterDefaultId: string | null;
  cashDrawerPrinterDefaultId: string | null;
};

const LIST_KEYS = {
  receipt: { ids: "receiptPrinterIds", defaultId: "receiptPrinterDefaultId" },
  payment_slip: { ids: "paymentSlipPrinterIds", defaultId: "paymentSlipPrinterDefaultId" },
  cash_drawer: { ids: "cashDrawerPrinterIds", defaultId: "cashDrawerPrinterDefaultId" },
} as const satisfies Record<
  ProfilePrinterRole,
  { ids: keyof ProfilePrinterLists; defaultId: keyof ProfilePrinterLists }
>;

const PROFILE_PRINTER_ROLES = Object.keys(LIST_KEYS) as ProfilePrinterRole[];

export function emptyPrinterLists(): ProfilePrinterLists {
  return {
    receiptPrinterIds: [],
    paymentSlipPrinterIds: [],
    cashDrawerPrinterIds: [],
    receiptPrinterDefaultId: null,
    paymentSlipPrinterDefaultId: null,
    cashDrawerPrinterDefaultId: null,
  };
}

/** Folds `device_profile_printers` rows, already in position order, into one profile's lists. */
export function foldPrinterLists(
  rows: { printerId: string; role: ProfilePrinterRole; isDefault: boolean }[],
): ProfilePrinterLists {
  const lists = emptyPrinterLists();
  for (const { printerId, role, isDefault } of rows) {
    const keys = LIST_KEYS[role];
    lists[keys.ids].push(printerId);
    if (isDefault) lists[keys.defaultId] = printerId;
  }
  return lists;
}

export async function readProfilePrinterLists(
  tx: Transaction,
  profileId: string,
): Promise<ProfilePrinterLists> {
  const rows = await tx
    .select({
      printerId: deviceProfilePrinters.printerId,
      role: deviceProfilePrinters.role,
      isDefault: deviceProfilePrinters.isDefault,
    })
    .from(deviceProfilePrinters)
    .where(eq(deviceProfilePrinters.deviceProfileId, profileId))
    .orderBy(asc(deviceProfilePrinters.position));
  return foldPrinterLists(rows);
}

/**
 * Replaces every list and default, then clears each of the profile's devices' choices the new lists
 * no longer offer it, acquiring nothing. Refuses, writing nothing, a deleted printer on any list or
 * default, even one already stored there; a default missing from its list; and a printer newly
 * added to the drawer list that has no cash drawer, while one already listed keeps its place
 * whatever its drawer flag says now. Delete-then-insert is safe because nothing references
 * `device_profile_printers`.
 */
export async function setProfilePrinterLists(
  tx: Transaction,
  profileId: string,
  lists: ProfilePrinterLists,
): Promise<void> {
  await refuseDeletedPrinters(
    tx,
    PROFILE_PRINTER_ROLES.flatMap((role) => [
      ...lists[LIST_KEYS[role].ids],
      lists[LIST_KEYS[role].defaultId],
    ]),
  );
  for (const role of PROFILE_PRINTER_ROLES) {
    const keys = LIST_KEYS[role];
    const defaultId = lists[keys.defaultId];
    if (defaultId !== null && !lists[keys.ids].includes(defaultId)) {
      throw new AppError("device_profile.invalid", {
        reason: "default_not_listed",
        field: keys.defaultId,
      });
    }
  }
  const stored = await readProfilePrinterLists(tx, profileId);
  const added = lists.cashDrawerPrinterIds.filter(
    (id) => !stored.cashDrawerPrinterIds.includes(id),
  );
  if (added.length > 0) {
    const withDrawer = await tx
      .select({ id: printers.id })
      .from(printers)
      .where(and(inArray(printers.id, added), eq(printers.hasCashDrawer, true)));
    if (withDrawer.length !== added.length) {
      throw new AppError("device_profile.invalid", {
        reason: "no_cash_drawer",
        field: "cashDrawerPrinterIds",
      });
    }
  }
  await tx
    .delete(deviceProfilePrinters)
    .where(eq(deviceProfilePrinters.deviceProfileId, profileId));
  const rows = PROFILE_PRINTER_ROLES.flatMap((role) => {
    const keys = LIST_KEYS[role];
    return lists[keys.ids].map((printerId, position) => ({
      deviceProfileId: profileId,
      printerId,
      role,
      position,
      isDefault: printerId === lists[keys.defaultId],
    }));
  });
  if (rows.length > 0) await tx.insert(deviceProfilePrinters).values(rows);
  await settleProfilePrinterDevices(tx, profileId);
}
