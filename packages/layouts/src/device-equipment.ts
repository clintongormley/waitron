// The registry of `printer.not_found`, which this file throws.
import "@waitron/printing";
import {
  deviceProfiles,
  devices,
  nowIso,
  isReceiptPrinter,
  removeIdFromJson,
  printers,
} from "@waitron/db";
import type { StoredPrinterLists, Transaction } from "@waitron/db";
import { and, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";
import { refuseDeletedPrinters } from "@waitron/printing";
import { AppError, mayTakeOver } from "@waitron/shared";
import type { EquipmentVia } from "@waitron/shared";
import type { ProfilePrinterRole } from "./device-printers.js";

const COLUMN = {
  receipt: "receiptPrinterId",
  payment_slip: "paymentSlipPrinterId",
  cash_drawer: "cashDrawerPrinterId",
  invoice: "invoicePrinterId",
} as const satisfies Record<ProfilePrinterRole, string>;

const ROLES: ProfilePrinterRole[] = ["receipt", "payment_slip", "cash_drawer", "invoice"];

/** Each role, in role order, with the device column holding the printer chosen for it. */
export const PRINTER_ROLE_COLUMNS: readonly {
  readonly role: ProfilePrinterRole;
  readonly column: (typeof COLUMN)[ProfilePrinterRole];
}[] = ROLES.map((role) => ({ role, column: COLUMN[role] }));

/** The roles whose portable printers have one holder; a cash drawer and invoices ignore holding. */
const HELD_ROLES = ["receipt", "payment_slip"] as const;
const NO_HOLDER = { heldByDeviceId: null, heldAt: null };

function isHeld(role: ProfilePrinterRole): boolean {
  return (HELD_ROLES as readonly ProfilePrinterRole[]).includes(role);
}

type ChoiceColumn = (typeof COLUMN)[ProfilePrinterRole];

/** A device's stored printer choice for each role; `null` is Use default. */
export type DevicePrinterChoices = Record<ChoiceColumn, string | null>;

type Choices = DevicePrinterChoices;

export function chosenPrinterOf(device: Choices, role: ProfilePrinterRole): string | null {
  return device[COLUMN[role]];
}

function choiceColumns(role: ProfilePrinterRole, printerId: string | null): Partial<Choices> {
  return { [COLUMN[role]]: printerId };
}

/** One role's stored choice, its profile default and who holds each, with what it resolves to. */
export type PrinterRoleState = {
  role: ProfilePrinterRole;
  chosenId: string | null;
  chosenHolderDeviceId: string | null;
  defaultId: string | null;
  defaultHolderDeviceId: string | null;
  resolvedId: string | null;
};

export type SelectDevicePrinterInput = {
  deviceId: string;
  role: ProfilePrinterRole;
  selection: "default" | { id: string };
  via: EquipmentVia;
  takeOver?: boolean;
};

export type SelectDevicePrinterResult =
  | { ok: true; previousHolderDeviceId: string | null }
  | { ok: false; refusal: "not_permitted" }
  | { ok: false; refusal: "held"; holderDeviceId: string };

type DeviceState = {
  device: {
    id: string;
    profileId: string;
    formFactor: string;
    receiptPrinterId: string | null;
    paymentSlipPrinterId: string | null;
    cashDrawerPrinterId: string | null;
    invoicePrinterId: string | null;
  };
  defaults: Map<ProfilePrinterRole, string>;
  portable: Set<string>;
  holderOf: Map<string, string>;
};

/**
 * A printer a device's role or its profile's list names, and the device holding it, if any. An `a4`
 * printer is a page printer, which only the invoice role names and nobody holds.
 */
export type PrinterInfo = {
  id: string;
  name: string;
  kind: "receipt" | "a4";
  portable: boolean;
  active: boolean;
  holderDeviceId: string | null;
};

/** A printer a profile lists for a role, switched on or not. */
export type ListedPrinter = {
  profileId: string;
  role: ProfilePrinterRole;
  id: string;
  active: boolean;
  isDefault: boolean;
};

/** What {@link readPrinterEquipment} reads; `listed`, empty without `lists`, is in list order. */
export type PrinterEquipment = {
  devices: { id: string; profileId: string }[];
  roles: Map<string, PrinterRoleState[]>;
  printers: Map<string, PrinterInfo>;
  listed: ListedPrinter[];
};

type StatesRead = {
  states: Map<string, DeviceState>;
  printers: Map<string, PrinterInfo>;
  listed: ListedPrinter[];
};

/**
 * Each known device's state, read with one query per table however many devices are asked for.
 * `withLists` also reads every printer the devices' profiles list, not only their defaults.
 */
async function readStatesWith(
  tx: Transaction,
  deviceIds: readonly string[],
  withLists: boolean,
): Promise<StatesRead> {
  if (deviceIds.length === 0) return { states: new Map(), printers: new Map(), listed: [] };
  const deviceRows = await tx
    .select({
      id: devices.id,
      profileId: devices.deviceProfileId,
      formFactor: deviceProfiles.formFactor,
      printerLists: deviceProfiles.printerLists,
      receiptPrinterId: devices.receiptPrinterId,
      paymentSlipPrinterId: devices.paymentSlipPrinterId,
      cashDrawerPrinterId: devices.cashDrawerPrinterId,
      invoicePrinterId: devices.invoicePrinterId,
    })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .where(inArray(devices.id, [...deviceIds]));
  if (deviceRows.length === 0) return { states: new Map(), printers: new Map(), listed: [] };
  const byProfile = new Map(
    deviceRows
      .filter((device) => device.formFactor !== "kds")
      .map((device) => [device.profileId, device.printerLists]),
  );
  const offers = [...byProfile].flatMap(([profileId, lists]) =>
    ROLES.flatMap((role) => {
      const list = lists[role];
      if (list === undefined) return [];
      const ids = withLists ? list.ids : list.defaultId === null ? [] : [list.defaultId];
      return ids.map((id) => ({ profileId, role, id, isDefault: id === list.defaultId }));
    }),
  );
  const usedIds = new Set(
    deviceRows
      .filter((device) => device.formFactor !== "kds")
      .flatMap((device) => ROLES.map((role) => chosenPrinterOf(device, role)))
      .filter((id): id is string => id !== null),
  );
  const ids = [...new Set([...usedIds, ...offers.map((offer) => offer.id)])];
  // Profiles can offer both receipt and A4 printers for the invoice role.
  const printerRows =
    ids.length === 0
      ? []
      : await tx
          .select({
            id: printers.id,
            name: printers.name,
            kind: printers.kind,
            portable: printers.portable,
            active: printers.active,
            holderDeviceId: printers.heldByDeviceId,
          })
          .from(printers)
          .where(inArray(printers.id, ids));
  const info = new Map<string, PrinterInfo>(printerRows.map((row) => [row.id, row]));
  const listed: ListedPrinter[] = [];
  const defaults = new Map<string, Map<ProfilePrinterRole, string>>(
    [...byProfile.keys()].map((id) => [id, new Map()]),
  );
  for (const offer of offers) {
    const printer = info.get(offer.id);
    if (printer === undefined || (offer.role !== "invoice" && printer.kind !== "receipt")) continue;
    usedIds.add(offer.id);
    if (withLists) listed.push({ ...offer, active: printer.active });
    if (offer.isDefault) defaults.get(offer.profileId)!.set(offer.role, offer.id);
  }
  for (const id of info.keys()) if (!usedIds.has(id)) info.delete(id);
  const portable = new Set(printerRows.filter((row) => row.portable).map((row) => row.id));
  const holderOf = new Map(
    printerRows.flatMap((row) =>
      row.holderDeviceId === null ? [] : [[row.id, row.holderDeviceId] as const],
    ),
  );
  return {
    states: new Map(
      deviceRows.map((device) => [
        device.id,
        { device, defaults: defaults.get(device.profileId) ?? new Map(), portable, holderOf },
      ]),
    ),
    printers: info,
    listed,
  };
}

async function readStates(
  tx: Transaction,
  deviceIds: readonly string[],
): Promise<Map<string, DeviceState>> {
  return (await readStatesWith(tx, deviceIds, false)).states;
}

async function readState(tx: Transaction, deviceId: string): Promise<DeviceState | undefined> {
  return (await readStates(tx, [deviceId])).get(deviceId);
}

function roleState(state: DeviceState, role: ProfilePrinterRole): PrinterRoleState {
  if (state.device.formFactor === "kds")
    return {
      role,
      chosenId: null,
      chosenHolderDeviceId: null,
      defaultId: null,
      defaultHolderDeviceId: null,
      resolvedId: null,
    };
  const held = isHeld(role);
  const holder = (id: string | null) =>
    id === null || !held ? null : (state.holderOf.get(id) ?? null);
  // A portable printer serves only the device holding it, whether chosen or the default.
  const resolves = (id: string | null) =>
    id === null || !held || !state.portable.has(id) || holder(id) === state.device.id ? id : null;
  const chosenId = chosenPrinterOf(state.device, role);
  const defaultId = state.defaults.get(role) ?? null;
  return {
    role,
    chosenId,
    chosenHolderDeviceId: holder(chosenId),
    defaultId,
    defaultHolderDeviceId: holder(defaultId),
    resolvedId: chosenId !== null ? resolves(chosenId) : resolves(defaultId),
  };
}

/** The printer `role` prints or opens on for the device, switched on or not; `null` for none. */
export async function resolveDevicePrinterId(
  tx: Transaction,
  deviceId: string,
  role: ProfilePrinterRole,
): Promise<string | null> {
  const state = await readState(tx, deviceId);
  return state === undefined ? null : roleState(state, role).resolvedId;
}

/** {@link resolveDevicePrinterId} for each of `deviceIds`, by device; an unknown device is left out. */
export async function resolveDevicePrinterIds(
  tx: Transaction,
  deviceIds: readonly string[],
  role: ProfilePrinterRole,
): Promise<Map<string, string | null>> {
  const states = await readStates(tx, deviceIds);
  return new Map([...states].map(([id, state]) => [id, roleState(state, role).resolvedId]));
}

/**
 * {@link readPrinterRoles} for each of `deviceIds`, with the printers their roles name and, with
 * `lists`, every printer their profiles list, read with at most four queries however many devices
 * are asked for; an unknown device is left out.
 */
export async function readPrinterEquipment(
  tx: Transaction,
  deviceIds: readonly string[],
  options: { lists: boolean },
): Promise<PrinterEquipment> {
  const read = await readStatesWith(tx, deviceIds, options.lists);
  const states = [...read.states.values()];
  return {
    devices: states.map(({ device }) => ({
      id: device.id,
      profileId: device.profileId,
    })),
    roles: new Map(
      states.map((state) => [state.device.id, ROLES.map((role) => roleState(state, role))]),
    ),
    printers: read.printers,
    listed: read.listed,
  };
}

/** Every printer role of the device, in role order; empty for an unknown device. */
export async function readPrinterRoles(
  tx: Transaction,
  deviceId: string,
): Promise<PrinterRoleState[]> {
  const state = await readState(tx, deviceId);
  return state === undefined ? [] : ROLES.map((role) => roleState(state, role));
}

export type DevicePrinterChoiceInput = SelectDevicePrinterInput & {
  /** The profile the choice is checked against, which may not yet be the device's. */
  profileId: string;
};

export type DevicePrinterChoiceCheck =
  | {
      ok: true;
      /** The device columns storing the choice. */
      columns: Partial<Choices>;
      /** The portable printer the device must hold for the choice, if any. */
      heldPrinterId: string | null;
      previousHolderDeviceId: string | null;
    }
  | { ok: false; refusal: "not_permitted" }
  | { ok: false; refusal: "held"; holderDeviceId: string };

/**
 * Checks, writing nothing, whether the device may newly choose `selection` for `role` on
 * `profileId`, by the rules of {@link selectDevicePrinter}; a deleted printer is thrown as
 * `printer.not_found`.
 */
export async function checkDevicePrinterChoice(
  tx: Transaction,
  input: DevicePrinterChoiceInput,
): Promise<DevicePrinterChoiceCheck> {
  const { deviceId, profileId, role, selection } = input;
  if (selection !== "default") await refuseDeletedPrinters(tx, [selection.id]);
  const [profile] = await tx
    .select({ formFactor: deviceProfiles.formFactor, lists: deviceProfiles.printerLists })
    .from(deviceProfiles)
    .where(eq(deviceProfiles.id, profileId));
  if (profile === undefined || profile.formFactor === "kds")
    return { ok: false, refusal: "not_permitted" };
  if (selection === "default") {
    return {
      ok: true,
      columns: choiceColumns(role, null),
      heldPrinterId: null,
      previousHolderDeviceId: null,
    };
  }
  if (profile.lists[role]?.ids.includes(selection.id) !== true)
    return { ok: false, refusal: "not_permitted" };
  const [listed] = await tx
    .select({
      printerId: printers.id,
      portable: printers.portable,
      holderDeviceId: printers.heldByDeviceId,
    })
    .from(printers)
    .where(
      and(
        eq(printers.id, selection.id),
        eq(printers.active, true),
        role === "invoice" ? undefined : isReceiptPrinter(),
      ),
    );
  if (listed === undefined) return { ok: false, refusal: "not_permitted" };
  const columns = choiceColumns(role, listed.printerId);
  if (listed.portable !== true || !isHeld(role)) {
    return { ok: true, columns, heldPrinterId: null, previousHolderDeviceId: null };
  }
  const { holderDeviceId } = listed;
  let previousHolderDeviceId: string | null = null;
  if (holderDeviceId !== null && holderDeviceId !== deviceId) {
    if (!mayTakeOver(input.via, input.takeOver)) {
      return { ok: false, refusal: "held", holderDeviceId };
    }
    previousHolderDeviceId = holderDeviceId;
  }
  return { ok: true, columns, heldPrinterId: selection.id, previousHolderDeviceId };
}

/**
 * Sets one role to Use default or to a printer the device may newly choose. A portable printer
 * another device holds is refused unless taken by a scan or a confirmed list choice, never by a
 * manager; taking it clears the previous holder's choices of it, and that device acquires nothing.
 * The drawer and invoice roles ignore holding.
 * A refusal is returned rather than thrown because its code belongs to the caller's surface; a
 * deleted printer, checked first, is thrown as `printer.not_found`.
 */
export async function selectDevicePrinter(
  tx: Transaction,
  input: SelectDevicePrinterInput,
): Promise<SelectDevicePrinterResult> {
  const { deviceId } = input;
  const [device] = await tx
    .select({ profileId: devices.deviceProfileId })
    .from(devices)
    .where(eq(devices.id, deviceId));
  if (device === undefined) {
    if (input.selection !== "default") await refuseDeletedPrinters(tx, [input.selection.id]);
    return { ok: false, refusal: "not_permitted" };
  }
  const check = await checkDevicePrinterChoice(tx, { ...input, profileId: device.profileId });
  if (!check.ok) return check;
  const { heldPrinterId, previousHolderDeviceId } = check;
  if (heldPrinterId !== null) {
    await tx
      .update(printers)
      .set({ heldByDeviceId: deviceId, heldAt: nowIso() })
      .where(and(isReceiptPrinter(), eq(printers.id, heldPrinterId)));
    if (previousHolderDeviceId !== null) {
      for (const held of HELD_ROLES) {
        await tx
          .update(devices)
          .set({ [COLUMN[held]]: null })
          .where(
            and(eq(devices.id, previousHolderDeviceId), eq(devices[COLUMN[held]], heldPrinterId)),
          );
      }
      await settleDevicePrinters(tx, previousHolderDeviceId, { acquire: false });
    }
  }
  await tx.update(devices).set(check.columns).where(eq(devices.id, deviceId));
  await settleDevicePrinters(tx, deviceId, { acquire: true });
  return { ok: true, previousHolderDeviceId };
}

/**
 * With `acquire`, takes each portable choice or, for a role on Use default, each portable default
 * that nobody holds, and puts a role whose portable choice another device holds back on Use
 * default; then lets go of every printer the device holds but no longer uses in any role. Never
 * takes a held printer.
 */
export async function settleDevicePrinters(
  tx: Transaction,
  deviceId: string,
  options: { acquire: boolean },
): Promise<void> {
  const state = await readState(tx, deviceId);
  if (state === undefined) return;
  if (state.device.formFactor === "kds") {
    await clearUnlisted(tx, state.device, {});
    await releaseDevicePrinters(tx, deviceId);
    return;
  }
  const used: string[] = [];
  for (const role of HELD_ROLES) {
    const chosenId = state.device[COLUMN[role]];
    if (chosenId !== null) {
      const holder = state.holderOf.get(chosenId);
      if (!options.acquire || !state.portable.has(chosenId) || holder === deviceId) {
        used.push(chosenId);
        continue;
      }
      if (holder === undefined) {
        await tx
          .update(printers)
          .set({ heldByDeviceId: deviceId, heldAt: nowIso() })
          .where(and(isReceiptPrinter(), eq(printers.id, chosenId)));
        state.holderOf.set(chosenId, deviceId);
        used.push(chosenId);
        continue;
      }
      await tx
        .update(devices)
        .set({ [COLUMN[role]]: null })
        .where(eq(devices.id, deviceId));
    }
    const defaultId = state.defaults.get(role);
    if (defaultId === undefined) continue;
    used.push(defaultId);
    if (options.acquire && state.portable.has(defaultId) && !state.holderOf.has(defaultId)) {
      await tx
        .update(printers)
        .set({ heldByDeviceId: deviceId, heldAt: nowIso() })
        .where(
          and(isReceiptPrinter(), eq(printers.id, defaultId), isNull(printers.heldByDeviceId)),
        );
      state.holderOf.set(defaultId, deviceId);
    }
  }
  await tx
    .update(printers)
    .set(NO_HOLDER)
    .where(
      and(
        isReceiptPrinter(),
        used.length === 0
          ? eq(printers.heldByDeviceId, deviceId)
          : and(eq(printers.heldByDeviceId, deviceId), notInArray(printers.id, used)),
      ),
    );
}

/** Puts every device that chose the printer for one of `roles` back on Use default for it. */
async function clearPrinterChoices(
  tx: Transaction,
  printerId: string,
  roles: readonly ProfilePrinterRole[],
): Promise<void> {
  for (const role of roles) {
    await tx
      .update(devices)
      .set({ [COLUMN[role]]: null })
      .where(eq(devices[COLUMN[role]], printerId));
  }
}

/** Clears a deleted printer from every device's choices, every profile's lists and its holder. */
export async function clearDeletedPrinter(tx: Transaction, printerId: string): Promise<void> {
  await clearPrinterChoices(tx, printerId, ROLES);
  await removeIdFromJson(tx, deviceProfiles.printerLists, printerId);
  await tx
    .update(printers)
    .set(NO_HOLDER)
    .where(and(isReceiptPrinter(), eq(printers.id, printerId)));
}

/** Clears a deleted page printer from every device's invoice choice and every profile's lists. */
export async function clearDeletedPagePrinter(
  tx: Transaction,
  pagePrinterId: string,
): Promise<void> {
  await tx
    .update(devices)
    .set({ invoicePrinterId: null })
    .where(eq(devices.invoicePrinterId, pagePrinterId));
  await removeIdFromJson(tx, deviceProfiles.printerLists, pagePrinterId);
}

/** Lets go of every printer the device holds; keeps its choices. */
export async function releaseDevicePrinters(tx: Transaction, deviceId: string): Promise<void> {
  await tx
    .update(printers)
    .set(NO_HOLDER)
    .where(and(isReceiptPrinter(), eq(printers.heldByDeviceId, deviceId)));
}

type ChoiceRow = Choices & { id: string };

const CHOICE_COLUMNS = {
  id: devices.id,
  receiptPrinterId: devices.receiptPrinterId,
  paymentSlipPrinterId: devices.paymentSlipPrinterId,
  cashDrawerPrinterId: devices.cashDrawerPrinterId,
  invoicePrinterId: devices.invoicePrinterId,
};

async function listedAt(tx: Transaction, profileId: string): Promise<StoredPrinterLists> {
  const [profile] = await tx
    .select({ lists: deviceProfiles.printerLists })
    .from(deviceProfiles)
    .where(and(eq(deviceProfiles.id, profileId), ne(deviceProfiles.formFactor, "kds")));
  return profile?.lists ?? {};
}

/** The choice columns that go back to Use default because `listed` does not name them. */
function unlistedColumns(device: Choices, listed: StoredPrinterLists): Partial<Choices> {
  let cleared: Partial<Choices> = {};
  for (const role of ROLES) {
    const chosenId = chosenPrinterOf(device, role);
    if (chosenId !== null && listed[role]?.ids.includes(chosenId) !== true) {
      cleared = { ...cleared, ...choiceColumns(role, null) };
    }
  }
  return cleared;
}

/**
 * The choice columns a device holding `stored` would put back on Use default on moving to
 * `profileId`, writing nothing: those of each choice that profile does not list.
 */
export async function choicesClearedOnProfile(
  tx: Transaction,
  stored: Choices,
  profileId: string,
): Promise<Partial<Choices>> {
  return unlistedColumns(stored, await listedAt(tx, profileId));
}

/** Returns the device's choices as they stand afterwards. */
async function clearUnlisted(
  tx: Transaction,
  device: ChoiceRow,
  listed: StoredPrinterLists,
): Promise<ChoiceRow> {
  const cleared = unlistedColumns(device, listed);
  if (Object.keys(cleared).length > 0) {
    await tx.update(devices).set(cleared).where(eq(devices.id, device.id));
  }
  return { ...device, ...cleared };
}

/**
 * Puts each of the device's roles back on Use default when its profile no longer lists the chosen
 * printer for that role; a switched-off listed printer stays chosen.
 */
export async function clearUnlistedPrinterChoices(
  tx: Transaction,
  deviceId: string,
): Promise<void> {
  const [device] = await tx
    .select({ ...CHOICE_COLUMNS, profileId: devices.deviceProfileId })
    .from(devices)
    .where(eq(devices.id, deviceId));
  if (device === undefined) return;
  await clearUnlisted(tx, device, await listedAt(tx, device.profileId));
}

/**
 * After the profile's lists change: clears each of its devices' choices no longer listed for that
 * role (a switched-off listed printer stays chosen) and lets go of what
 * they no longer use, acquiring nothing.
 */
export async function settleProfilePrinterDevices(
  tx: Transaction,
  profileId: string,
): Promise<void> {
  const onProfile = await tx
    .select(CHOICE_COLUMNS)
    .from(devices)
    .where(eq(devices.deviceProfileId, profileId));
  if (onProfile.length === 0) return;
  const listed = await listedAt(tx, profileId);
  const usedBy = new Map<string, string[]>();
  for (const device of onProfile) {
    const kept = await clearUnlisted(tx, device, listed);
    // As settleDevicePrinters without acquiring: each held role uses its choice, else its default.
    usedBy.set(
      device.id,
      HELD_ROLES.flatMap((role) => {
        const id = kept[COLUMN[role]] ?? listed[role]?.defaultId ?? null;
        return id === null ? [] : [id];
      }),
    );
  }
  const held = await tx
    .select({ printerId: printers.id, deviceId: printers.heldByDeviceId })
    .from(printers)
    .where(and(isReceiptPrinter(), inArray(printers.heldByDeviceId, [...usedBy.keys()])));
  const released = held
    .filter((row) => !usedBy.get(row.deviceId!)!.includes(row.printerId))
    .map((row) => row.printerId);
  if (released.length > 0) {
    await tx
      .update(printers)
      .set(NO_HOLDER)
      .where(and(isReceiptPrinter(), inArray(printers.id, released)));
  }
}

/**
 * Marking a printer portable puts every device that chose it for receipts or slips back on Use
 * default and gives it to nobody; marking it fixed drops its holder and leaves the choices. Drawer
 * and invoice choices are never touched.
 */
export async function setPrinterPortable(
  tx: Transaction,
  printerId: string,
  portable: boolean,
): Promise<void> {
  const [printer] = await tx
    .select({ portable: printers.portable })
    .from(printers)
    .where(and(isReceiptPrinter(), eq(printers.id, printerId), isNull(printers.deletedAt)));
  if (printer === undefined) throw new AppError("printer.not_found", { id: printerId });
  if (printer.portable === portable) return;
  await tx
    .update(printers)
    .set(portable ? { portable } : { portable, ...NO_HOLDER })
    .where(and(isReceiptPrinter(), eq(printers.id, printerId)));
  if (portable) await clearPrinterChoices(tx, printerId, HELD_ROLES);
}
