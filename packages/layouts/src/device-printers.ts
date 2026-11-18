// The registry of `printer.not_found`, which this file throws.
import "@waitron/printing";
import "./errors.js";
import { deviceProfiles, isReceiptPrinter, printers } from "@waitron/db";
import type { PrinterListRole, StoredPrinterLists, Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { settleProfilePrinterDevices } from "./device-equipment.js";

export type PrinterRole = "receipt" | "payment_slip";

/**
 * Every role a profile lists printers for; a cash drawer is never chosen through `PrinterRole`, and
 * only the invoice list may name a page printer.
 */
export type ProfilePrinterRole = PrinterListRole;

/** Each role's list in display order and its default, which is on that list or `null` for none. */
export type ProfilePrinterLists = {
  receiptPrinterIds: string[];
  paymentSlipPrinterIds: string[];
  cashDrawerPrinterIds: string[];
  invoicePrinterIds: string[];
  receiptPrinterDefaultId: string | null;
  paymentSlipPrinterDefaultId: string | null;
  cashDrawerPrinterDefaultId: string | null;
  invoicePrinterDefaultId: string | null;
};

const LIST_KEYS = {
  receipt: { ids: "receiptPrinterIds", defaultId: "receiptPrinterDefaultId" },
  payment_slip: { ids: "paymentSlipPrinterIds", defaultId: "paymentSlipPrinterDefaultId" },
  cash_drawer: { ids: "cashDrawerPrinterIds", defaultId: "cashDrawerPrinterDefaultId" },
  invoice: { ids: "invoicePrinterIds", defaultId: "invoicePrinterDefaultId" },
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
    invoicePrinterIds: [],
    receiptPrinterDefaultId: null,
    paymentSlipPrinterDefaultId: null,
    cashDrawerPrinterDefaultId: null,
    invoicePrinterDefaultId: null,
  };
}

export function printerListsFrom(stored: StoredPrinterLists): ProfilePrinterLists {
  const lists = emptyPrinterLists();
  for (const role of PROFILE_PRINTER_ROLES) {
    const list = stored[role];
    if (list === undefined) continue;
    const keys = LIST_KEYS[role];
    lists[keys.ids] = [...list.ids];
    lists[keys.defaultId] = list.defaultId;
  }
  return lists;
}

function storedPrinterListsFrom(lists: ProfilePrinterLists): StoredPrinterLists {
  const stored: StoredPrinterLists = {};
  for (const role of PROFILE_PRINTER_ROLES) {
    const keys = LIST_KEYS[role];
    const ids = lists[keys.ids];
    if (ids.length > 0) stored[role] = { ids, defaultId: lists[keys.defaultId] };
  }
  return stored;
}

export function readProfilesListingPrinter(tx: Transaction, printerId: string) {
  return tx
    .select({
      id: deviceProfiles.id,
      name: deviceProfiles.name,
      lists: deviceProfiles.printerLists,
    })
    .from(deviceProfiles)
    .where(
      sql`exists (select 1 from json_tree(${deviceProfiles.printerLists}) where atom = ${printerId})`,
    );
}

export async function readProfilePrinterLists(
  tx: Transaction,
  profileId: string,
): Promise<ProfilePrinterLists> {
  const [profile] = await tx
    .select({ lists: deviceProfiles.printerLists })
    .from(deviceProfiles)
    .where(and(eq(deviceProfiles.id, profileId), ne(deviceProfiles.formFactor, "kds")));
  return printerListsFrom(profile?.lists ?? {});
}

/**
 * A kitchen profile stores no lists or defaults. For other profiles, replaces every list and
 * default, then clears each of the profile's devices' choices the new lists
 * no longer offer it, acquiring nothing. Refuses, writing nothing, a deleted printer on any list or
 * default, even one already stored there; a default missing from its list; and a printer newly
 * added to the drawer list that has no cash drawer, while one already listed keeps its place
 * whatever its drawer flag says now. Refuses an id that names no printer the list may hold — any
 * printer for the invoice list, which also takes a page printer, and a receipt printer for every
 * other — with `printer.not_found`. Each role lists a printer at most once.
 */
export async function setProfilePrinterLists(
  tx: Transaction,
  profileId: string,
  lists: ProfilePrinterLists,
): Promise<void> {
  const [profile] = await tx
    .select({ formFactor: deviceProfiles.formFactor, lists: deviceProfiles.printerLists })
    .from(deviceProfiles)
    .where(eq(deviceProfiles.id, profileId));
  if (profile?.formFactor === "kds") lists = emptyPrinterLists();
  await refuseUnknownPrinters(tx, lists);
  for (const role of PROFILE_PRINTER_ROLES) {
    const keys = LIST_KEYS[role];
    const defaultId = lists[keys.defaultId];
    const ids = lists[keys.ids];
    if (new Set(ids).size !== ids.length) {
      throw new AppError("device_profile.invalid", {
        reason: "duplicate_printer",
        field: keys.ids,
      });
    }
    if (defaultId !== null && !ids.includes(defaultId)) {
      throw new AppError("device_profile.invalid", {
        reason: "default_not_listed",
        field: keys.defaultId,
      });
    }
  }
  const stored = printerListsFrom(profile?.lists ?? {});
  const added = lists.cashDrawerPrinterIds.filter(
    (id) => !stored.cashDrawerPrinterIds.includes(id),
  );
  if (added.length > 0) {
    const withDrawer = await tx
      .select({ id: printers.id })
      .from(printers)
      .where(
        and(isReceiptPrinter(), inArray(printers.id, added), eq(printers.hasCashDrawer, true)),
      );
    if (withDrawer.length !== added.length) {
      throw new AppError("device_profile.invalid", {
        reason: "no_cash_drawer",
        field: "cashDrawerPrinterIds",
      });
    }
  }
  await tx
    .update(deviceProfiles)
    .set({ printerLists: storedPrinterListsFrom(lists) })
    .where(eq(deviceProfiles.id, profileId));
  await settleProfilePrinterDevices(tx, profileId);
}

/**
 * Refuses with `printer.not_found` the first id on a list or default that names a deleted printer,
 * then the first listed id that names no printer its list may hold. Switched-off state is
 * judged where a device resolves the role.
 */
async function refuseUnknownPrinters(tx: Transaction, lists: ProfilePrinterLists): Promise<void> {
  const named = [
    ...new Set(
      PROFILE_PRINTER_ROLES.flatMap((role) => [
        ...lists[LIST_KEYS[role].ids],
        lists[LIST_KEYS[role].defaultId],
      ]).filter((id): id is string => id !== null),
    ),
  ];
  if (named.length === 0) return;
  // The invoice role can use either kind.
  const rows = await tx
    .select({ id: printers.id, kind: printers.kind, deletedAt: printers.deletedAt })
    .from(printers)
    .where(inArray(printers.id, named));
  const found = new Map(
    rows.filter((row) => row.kind === "receipt").map((row) => [row.id, row.deletedAt]),
  );
  const deleted = named.find((id) => (found.get(id) ?? null) !== null);
  if (deleted !== undefined) throw new AppError("printer.not_found", { id: deleted });
  const pageIds = new Set(rows.filter((row) => row.kind === "a4").map((row) => row.id));
  for (const role of PROFILE_PRINTER_ROLES) {
    const unknown = lists[LIST_KEYS[role].ids].find(
      (id) => !found.has(id) && !(role === "invoice" && pageIds.has(id)),
    );
    if (unknown !== undefined) throw new AppError("printer.not_found", { id: unknown });
  }
}
