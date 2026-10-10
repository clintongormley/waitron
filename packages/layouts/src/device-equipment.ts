// The registry of `printer.not_found`, which this file throws.
import "@waitron/printing";
import { deviceProfilePrinters, devices, nowIso, printerHolders, printers } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { and, asc, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { AppError, mayTakeOver } from "@waitron/shared";
import type { EquipmentVia } from "@waitron/shared";
import type { ProfilePrinterRole } from "./device-printers.js";

const COLUMN = {
  receipt: "receiptPrinterId",
  payment_slip: "paymentSlipPrinterId",
  cash_drawer: "cashDrawerPrinterId",
} as const satisfies Record<ProfilePrinterRole, string>;

const ROLES: ProfilePrinterRole[] = ["receipt", "payment_slip", "cash_drawer"];

/** The roles whose portable printers have one holder; a cash drawer is never held. */
const HELD_ROLES = ["receipt", "payment_slip"] as const;

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
    locationId: string;
    receiptPrinterId: string | null;
    paymentSlipPrinterId: string | null;
    cashDrawerPrinterId: string | null;
  };
  defaults: Map<ProfilePrinterRole, string>;
  portable: Set<string>;
  holderOf: Map<string, string>;
};

/** A printer a device's role or its profile's list names, and the device holding it, if any. */
export type PrinterInfo = {
  id: string;
  name: string;
  portable: boolean;
  active: boolean;
  holderDeviceId: string | null;
};

/** A printer a profile lists for a role, wherever it is and switched on or not. */
export type ListedPrinter = {
  profileId: string;
  role: ProfilePrinterRole;
  id: string;
  locationId: string;
  active: boolean;
  isDefault: boolean;
};

/** What {@link readPrinterEquipment} reads; `listed`, empty without `lists`, is in list order. */
export type PrinterEquipment = {
  devices: { id: string; profileId: string; locationId: string }[];
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
      locationId: devices.locationId,
      receiptPrinterId: devices.receiptPrinterId,
      paymentSlipPrinterId: devices.paymentSlipPrinterId,
      cashDrawerPrinterId: devices.cashDrawerPrinterId,
    })
    .from(devices)
    .where(inArray(devices.id, [...deviceIds]));
  if (deviceRows.length === 0) return { states: new Map(), printers: new Map(), listed: [] };
  const profileIds = [...new Set(deviceRows.map((device) => device.profileId))];
  const profileRows = await tx
    .select({
      profileId: deviceProfilePrinters.deviceProfileId,
      role: deviceProfilePrinters.role,
      id: printers.id,
      locationId: printers.locationId,
      active: printers.active,
      isDefault: deviceProfilePrinters.isDefault,
    })
    .from(deviceProfilePrinters)
    .innerJoin(printers, eq(printers.id, deviceProfilePrinters.printerId))
    .where(
      withLists
        ? inArray(deviceProfilePrinters.deviceProfileId, profileIds)
        : and(
            inArray(deviceProfilePrinters.deviceProfileId, profileIds),
            eq(deviceProfilePrinters.isDefault, true),
          ),
    )
    .orderBy(asc(deviceProfilePrinters.position));
  const defaultsOf = new Map<string, Map<ProfilePrinterRole, string>>();
  for (const device of deviceRows) {
    defaultsOf.set(
      device.id,
      new Map(
        profileRows
          .filter(
            (row) =>
              row.isDefault &&
              row.profileId === device.profileId &&
              row.locationId === device.locationId,
          )
          .map((row) => [row.role, row.id]),
      ),
    );
  }
  const ids = [
    ...new Set([
      ...deviceRows.flatMap((device) => [
        ...ROLES.map((role) => device[COLUMN[role]]),
        ...defaultsOf.get(device.id)!.values(),
      ]),
      ...(withLists ? profileRows.map((row) => row.id) : []),
    ]),
  ].filter((id): id is string => id !== null);
  const printerRows =
    ids.length === 0
      ? []
      : await tx
          .select({
            id: printers.id,
            name: printers.name,
            portable: printers.portable,
            active: printers.active,
            holderDeviceId: printerHolders.deviceId,
          })
          .from(printers)
          .leftJoin(printerHolders, eq(printerHolders.printerId, printers.id))
          .where(inArray(printers.id, ids));
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
        { device, defaults: defaultsOf.get(device.id)!, portable, holderOf },
      ]),
    ),
    printers: new Map(printerRows.map((row) => [row.id, row])),
    listed: withLists ? profileRows : [],
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
  const held = role !== "cash_drawer";
  const holder = (id: string | null) =>
    id === null || !held ? null : (state.holderOf.get(id) ?? null);
  // A portable printer serves only the device holding it, whether chosen or the default.
  const resolves = (id: string | null) =>
    id === null || !held || !state.portable.has(id) || holder(id) === state.device.id ? id : null;
  const chosenId = state.device[COLUMN[role]];
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

/**
 * Refuses `printer.not_found` for the first of `ids` naming a deleted printer, whether or not the
 * caller already stores it. An unknown or switched-off printer passes this check.
 */
export async function refuseDeletedPrinters(
  tx: Transaction,
  ids: readonly (string | null | undefined)[],
): Promise<void> {
  const named = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
  if (named.length === 0) return;
  const deleted = await tx
    .select({ id: printers.id })
    .from(printers)
    .where(and(inArray(printers.id, named), isNotNull(printers.deletedAt)));
  const first = named.find((id) => deleted.some((row) => row.id === id));
  if (first !== undefined) throw new AppError("printer.not_found", { id: first });
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
 * `lists`, every printer their profiles list, read with three queries however many devices are
 * asked for; an unknown device is left out.
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
      locationId: device.locationId,
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

/**
 * Sets one role to Use default or to a printer the device may newly choose. A portable printer
 * another device holds is refused unless taken by a scan or a confirmed list choice, never by a
 * manager; taking it clears the previous holder's choices of it, and that device acquires nothing.
 * A refusal is returned rather than thrown because its code belongs to the caller's surface; a
 * deleted printer, checked first, is thrown as `printer.not_found`.
 */
export async function selectDevicePrinter(
  tx: Transaction,
  input: SelectDevicePrinterInput,
): Promise<SelectDevicePrinterResult> {
  const { deviceId, role, selection } = input;
  if (selection !== "default") await refuseDeletedPrinters(tx, [selection.id]);
  const [device] = await tx
    .select({ profileId: devices.deviceProfileId, locationId: devices.locationId })
    .from(devices)
    .where(eq(devices.id, deviceId));
  if (device === undefined) return { ok: false, refusal: "not_permitted" };
  let previousHolderDeviceId: string | null = null;
  if (selection === "default") {
    await tx
      .update(devices)
      .set({ [COLUMN[role]]: null })
      .where(eq(devices.id, deviceId));
  } else {
    const [printer] = await tx
      .select({ id: printers.id, portable: printers.portable })
      .from(deviceProfilePrinters)
      .innerJoin(printers, eq(printers.id, deviceProfilePrinters.printerId))
      .where(
        and(
          eq(deviceProfilePrinters.deviceProfileId, device.profileId),
          eq(deviceProfilePrinters.role, role),
          eq(printers.id, selection.id),
          eq(printers.locationId, device.locationId),
          eq(printers.active, true),
        ),
      );
    if (printer === undefined) return { ok: false, refusal: "not_permitted" };
    if (printer.portable && role !== "cash_drawer") {
      const [holder] = await tx
        .select({ deviceId: printerHolders.deviceId })
        .from(printerHolders)
        .where(eq(printerHolders.printerId, printer.id));
      if (holder !== undefined && holder.deviceId !== deviceId) {
        if (!mayTakeOver(input.via, input.takeOver)) {
          return { ok: false, refusal: "held", holderDeviceId: holder.deviceId };
        }
        previousHolderDeviceId = holder.deviceId;
      }
      await tx
        .insert(printerHolders)
        .values({ printerId: printer.id, deviceId })
        .onConflictDoUpdate({
          target: printerHolders.printerId,
          set: { deviceId, heldAt: nowIso() },
        });
      if (previousHolderDeviceId !== null) {
        for (const held of HELD_ROLES) {
          await tx
            .update(devices)
            .set({ [COLUMN[held]]: null })
            .where(
              and(eq(devices.id, previousHolderDeviceId), eq(devices[COLUMN[held]], printer.id)),
            );
        }
        await settleDevicePrinters(tx, previousHolderDeviceId, { acquire: false });
      }
    }
    await tx
      .update(devices)
      .set({ [COLUMN[role]]: printer.id })
      .where(eq(devices.id, deviceId));
  }
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
        await tx.insert(printerHolders).values({ printerId: chosenId, deviceId });
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
        .insert(printerHolders)
        .values({ printerId: defaultId, deviceId })
        .onConflictDoNothing({ target: printerHolders.printerId });
      state.holderOf.set(defaultId, deviceId);
    }
  }
  await tx
    .delete(printerHolders)
    .where(
      used.length === 0
        ? eq(printerHolders.deviceId, deviceId)
        : and(eq(printerHolders.deviceId, deviceId), notInArray(printerHolders.printerId, used)),
    );
}

/** Lets go of every printer the device holds; keeps its choices. */
export async function releaseDevicePrinters(tx: Transaction, deviceId: string): Promise<void> {
  await tx.delete(printerHolders).where(eq(printerHolders.deviceId, deviceId));
}

type ChoiceRow = {
  id: string;
  locationId: string;
  receiptPrinterId: string | null;
  paymentSlipPrinterId: string | null;
  cashDrawerPrinterId: string | null;
};

const CHOICE_COLUMNS = {
  id: devices.id,
  locationId: devices.locationId,
  receiptPrinterId: devices.receiptPrinterId,
  paymentSlipPrinterId: devices.paymentSlipPrinterId,
  cashDrawerPrinterId: devices.cashDrawerPrinterId,
};

type Listed = { id: string; role: ProfilePrinterRole; isDefault: boolean };

function listedAt(tx: Transaction, profileId: string, locationId: string): Promise<Listed[]> {
  return tx
    .select({
      id: printers.id,
      role: deviceProfilePrinters.role,
      isDefault: deviceProfilePrinters.isDefault,
    })
    .from(deviceProfilePrinters)
    .innerJoin(printers, eq(printers.id, deviceProfilePrinters.printerId))
    .where(
      and(
        eq(deviceProfilePrinters.deviceProfileId, profileId),
        eq(printers.locationId, locationId),
      ),
    );
}

/** Returns the device's choices as they stand afterwards. */
async function clearUnlisted(
  tx: Transaction,
  device: ChoiceRow,
  listed: Listed[],
): Promise<ChoiceRow> {
  const cleared: Partial<Record<(typeof COLUMN)[ProfilePrinterRole], null>> = {};
  for (const role of ROLES) {
    const chosenId = device[COLUMN[role]];
    if (chosenId !== null && !listed.some((p) => p.role === role && p.id === chosenId)) {
      cleared[COLUMN[role]] = null;
    }
  }
  if (Object.keys(cleared).length > 0) {
    await tx.update(devices).set(cleared).where(eq(devices.id, device.id));
  }
  return { ...device, ...cleared };
}

/**
 * Puts each of the device's roles back on Use default when its profile no longer lists the chosen
 * printer for that role at the device's location; a switched-off listed printer stays chosen.
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
  await clearUnlisted(tx, device, await listedAt(tx, device.profileId, device.locationId));
}

/**
 * After the profile's lists change: clears each of its devices' choices no longer listed for that
 * role at the device's location (a switched-off listed printer stays chosen) and lets go of what
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
  const byLocation = new Map<string, Listed[]>();
  const usedBy = new Map<string, string[]>();
  for (const device of onProfile) {
    let listed = byLocation.get(device.locationId);
    if (listed === undefined) {
      listed = await listedAt(tx, profileId, device.locationId);
      byLocation.set(device.locationId, listed);
    }
    const kept = await clearUnlisted(tx, device, listed);
    // As settleDevicePrinters without acquiring: each held role uses its choice, else its default.
    usedBy.set(
      device.id,
      HELD_ROLES.flatMap((role) => {
        const id =
          kept[COLUMN[role]] ?? listed.find((p) => p.role === role && p.isDefault)?.id ?? null;
        return id === null ? [] : [id];
      }),
    );
  }
  const held = await tx
    .select({ printerId: printerHolders.printerId, deviceId: printerHolders.deviceId })
    .from(printerHolders)
    .where(inArray(printerHolders.deviceId, [...usedBy.keys()]));
  const released = held
    .filter((row) => !usedBy.get(row.deviceId)!.includes(row.printerId))
    .map((row) => row.printerId);
  if (released.length > 0) {
    await tx.delete(printerHolders).where(inArray(printerHolders.printerId, released));
  }
}

/**
 * Marking a printer portable puts every device that chose it for receipts or slips back on Use
 * default and gives it to nobody; marking it fixed drops its holder and leaves the choices. Drawer
 * choices are never touched.
 */
export async function setPrinterPortable(
  tx: Transaction,
  printerId: string,
  portable: boolean,
): Promise<void> {
  const [printer] = await tx
    .select({ portable: printers.portable })
    .from(printers)
    .where(and(eq(printers.id, printerId), isNull(printers.deletedAt)));
  if (printer === undefined) throw new AppError("printer.not_found", { id: printerId });
  if (printer.portable === portable) return;
  await tx.update(printers).set({ portable }).where(eq(printers.id, printerId));
  if (portable) {
    for (const role of HELD_ROLES) {
      await tx
        .update(devices)
        .set({ [COLUMN[role]]: null })
        .where(eq(devices[COLUMN[role]], printerId));
    }
  } else {
    await tx.delete(printerHolders).where(eq(printerHolders.printerId, printerId));
  }
}
