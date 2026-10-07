import "./errors.js";
import type { EquipmentField } from "./errors.js";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { devices, printerHolders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { persons, sessions } from "@waitron/identity";
import {
  clearUnlistedPrinterChoices,
  readPrinterEquipment,
  releaseDevicePrinters,
  selectDevicePrinter,
  settleDevicePrinters,
} from "@waitron/layouts";
import type { PrinterEquipment, PrinterRoleState, ProfilePrinterRole } from "@waitron/layouts";
import {
  DEMO_READER_ID,
  IN_PROGRESS_PAYMENT_STATES,
  cardReaderHolders,
  clearUnlistedReaderChoice,
  payments,
  readReaderEquipment,
  releaseDeviceReader,
  selectDeviceReader,
  settleDeviceReader,
} from "@waitron/payments";
import type { ReaderEquipment, ReaderRoleState } from "@waitron/payments";
import { AppError } from "@waitron/shared";

export type EquipmentRole = ProfilePrinterRole | "card_terminal";

/** The other device holding an item, and who is signed in on it, if anyone. */
export type Holder = { deviceId: string; deviceName: string; personName: string | null };

export type EquipmentItem = {
  id: string;
  name: string;
  portable: boolean;
  /** Switched on; a reader also not unpaired. */
  available: boolean;
  /** A reader another device has a payment in progress on; a printer never is. */
  busy: boolean;
  /** Another device holding it, never this one; a cash drawer is never held. */
  heldBy: Holder | null;
  /** A reader's card provider; a printer has none. */
  provider?: string;
};

export type RoleEquipment = {
  role: EquipmentRole;
  selection: "default" | "item";
  chosenId: string | null;
  /** What the role prints, opens or pays on now. */
  resolved: { id: string; name: string; available: boolean; provider?: string } | null;
  chosen: EquipmentItem | null;
  default: EquipmentItem | null;
  /** What the device may newly choose for the role, in list order. */
  choices: EquipmentItem[];
};

export type DeviceEquipment = { roles: RoleEquipment[] };

/** A role as the devices list shows it: what the device chose and what that resolves to. */
export type RoleSummary = Pick<RoleEquipment, "role" | "selection" | "chosenId" | "resolved">;

/**
 * After a device joins, comes back or moves profile: puts each role whose choice the profile no
 * longer lists back on Use default, lets go of what it no longer uses, and with `acquire` takes the
 * profile's free portable defaults.
 */
export async function settleDevice(
  tx: Transaction,
  deviceId: string,
  options: { acquire: boolean },
): Promise<void> {
  await clearUnlistedPrinterChoices(tx, deviceId);
  await settleDevicePrinters(tx, deviceId, options);
  await clearUnlistedReaderChoice(tx, deviceId);
  await settleDeviceReader(tx, deviceId, options);
}

/** Each portable printer some device holds, by printer, with who holds it. */
export async function readPrinterHolders(tx: Transaction): Promise<Map<string, Holder>> {
  const held = await tx
    .select({ itemId: printerHolders.printerId, deviceId: printerHolders.deviceId })
    .from(printerHolders);
  return namedHolders(tx, held);
}

/** Each card reader some device holds, by reader, with who holds it. */
export async function readReaderHolders(tx: Transaction): Promise<Map<string, Holder>> {
  const held = await tx
    .select({ itemId: cardReaderHolders.readerId, deviceId: cardReaderHolders.deviceId })
    .from(cardReaderHolders);
  return namedHolders(tx, held);
}

async function namedHolders(
  tx: Transaction,
  held: { itemId: string; deviceId: string }[],
): Promise<Map<string, Holder>> {
  const holders = await holdersByDevice(tx, [...new Set(held.map((row) => row.deviceId))]);
  return new Map(held.map((row) => [row.itemId, holders.get(row.deviceId)!]));
}

export async function releaseDevice(tx: Transaction, deviceId: string): Promise<void> {
  await releaseDevicePrinters(tx, deviceId);
  await releaseDeviceReader(tx, deviceId);
}

type Info = { id: string; name: string; portable: boolean; available: boolean; provider?: string };

const FIELD: Record<EquipmentRole, EquipmentField> = {
  receipt: "receiptPrinterId",
  payment_slip: "paymentSlipPrinterId",
  cash_drawer: "cashDrawerPrinterId",
  card_terminal: "cardReaderId",
};

async function holdersByDevice(tx: Transaction, deviceIds: string[]): Promise<Map<string, Holder>> {
  if (deviceIds.length === 0) return new Map();
  const named = await tx
    .select({ id: devices.id, label: devices.label })
    .from(devices)
    .where(inArray(devices.id, deviceIds));
  const signedIn = await tx
    .select({ deviceId: sessions.deviceId, name: persons.displayName })
    .from(sessions)
    .innerJoin(persons, eq(persons.id, sessions.personId))
    .where(and(inArray(sessions.deviceId, deviceIds), isNull(sessions.endedAt)))
    .orderBy(desc(sessions.openedAt));
  const personOf = new Map<string, string>();
  for (const row of signedIn) {
    if (row.deviceId !== null && !personOf.has(row.deviceId)) personOf.set(row.deviceId, row.name);
  }
  return new Map(
    named.map((row) => [
      row.id,
      { deviceId: row.id, deviceName: row.label, personName: personOf.get(row.id) ?? null },
    ]),
  );
}

function printerInfoOf(equipment: PrinterEquipment): Map<string, Info> {
  return new Map(
    [...equipment.printers.values()].map((row) => [
      row.id,
      { id: row.id, name: row.name, portable: row.portable, available: row.active },
    ]),
  );
}

function readerInfoOf(equipment: ReaderEquipment): Map<string, Info> {
  return new Map(
    [...equipment.readers.values()].map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        portable: true,
        available: row.active && row.unpairedAt === null,
        provider: row.provider,
      },
    ]),
  );
}

function summaryOf(
  role: EquipmentRole,
  state: PrinterRoleState | ReaderRoleState,
  info: Map<string, Info>,
): RoleSummary {
  const resolved = state.resolvedId === null ? null : info.get(state.resolvedId)!;
  return {
    role,
    selection: state.chosenId === null ? "default" : "item",
    chosenId: state.chosenId,
    resolved:
      resolved === null
        ? null
        : {
            id: resolved.id,
            name: resolved.name,
            available: resolved.available,
            ...(resolved.provider === undefined ? {} : { provider: resolved.provider }),
          },
  };
}

/** Every role of the device: its choice, its default, who holds each and what it may choose. */
export async function readDeviceEquipment(
  tx: Transaction,
  deviceId: string,
): Promise<DeviceEquipment> {
  const printerEquipment = await readPrinterEquipment(tx, [deviceId], { lists: true });
  const [device] = printerEquipment.devices;
  if (device === undefined) throw new AppError("device.not_found", { deviceId });
  const readerEquipment = await readReaderEquipment(tx, [device], { lists: true });
  const printerInfo = printerInfoOf(printerEquipment);
  const readerInfo = readerInfoOf(readerEquipment);
  const holderMap = (items: Iterable<{ id: string; holderDeviceId: string | null }>) =>
    new Map(
      [...items].flatMap((row) =>
        row.holderDeviceId === null ? [] : [[row.id, row.holderDeviceId] as const],
      ),
    );
  const printerHolder = holderMap(printerEquipment.printers.values());
  const readerHolder = holderMap(readerEquipment.readers.values());
  const readerIds = [...readerEquipment.readers.keys()];
  const inProgress =
    readerIds.length === 0
      ? []
      : await tx
          .select({ readerId: payments.readerId, deviceId: payments.deviceId })
          .from(payments)
          .where(
            and(
              inArray(payments.readerId, readerIds),
              inArray(payments.state, IN_PROGRESS_PAYMENT_STATES),
            ),
          );
  const holders = await holdersByDevice(tx, [
    ...new Set([...printerHolder.values(), ...readerHolder.values()]),
  ]);

  const item = (
    info: Map<string, Info>,
    holderOf: Map<string, string> | null,
    id: string | null,
  ): EquipmentItem | null => {
    if (id === null) return null;
    const holder = holderOf?.get(id);
    return {
      ...info.get(id)!,
      busy: inProgress.some((row) => row.readerId === id && row.deviceId !== device.id),
      heldBy: holder === undefined || holder === device.id ? null : holders.get(holder)!,
    };
  };
  const role = (
    name: EquipmentRole,
    state: PrinterRoleState | ReaderRoleState,
    info: Map<string, Info>,
    holderOf: Map<string, string> | null,
    choiceIds: string[],
  ): RoleEquipment => ({
    ...summaryOf(name, state, info),
    chosen: item(info, holderOf, state.chosenId),
    default: item(info, holderOf, state.defaultId),
    choices: choiceIds.map((id) => item(info, holderOf, id)!),
  });
  return {
    roles: [
      ...printerEquipment.roles.get(device.id)!.map((state) =>
        role(
          state.role,
          state,
          printerInfo,
          state.role === "cash_drawer" ? null : printerHolder,
          printerEquipment.listed
            .filter(
              (p) =>
                p.profileId === device.profileId &&
                p.locationId === device.locationId &&
                p.role === state.role &&
                p.active,
            )
            .map((p) => p.id),
        ),
      ),
      role(
        "card_terminal",
        readerEquipment.roles.get(device.id)!,
        readerInfo,
        readerHolder,
        readerEquipment.listed
          .filter((r) => r.profileId === device.profileId && r.id !== DEMO_READER_ID)
          .map((r) => r.id)
          .filter((id) => readerInfo.get(id)!.available),
      ),
    ],
  };
}

/**
 * What each device's roles resolve to, by device, with a fixed number of queries however many
 * devices are asked for; an unknown device is left out.
 */
export async function readDevicesEquipment(
  tx: Transaction,
  deviceIds: readonly string[],
): Promise<Map<string, RoleSummary[]>> {
  const printerEquipment = await readPrinterEquipment(tx, deviceIds, { lists: false });
  if (printerEquipment.devices.length === 0) return new Map();
  const readerEquipment = await readReaderEquipment(tx, printerEquipment.devices, {
    lists: false,
  });
  const printerInfo = printerInfoOf(printerEquipment);
  const readerInfo = readerInfoOf(readerEquipment);
  return new Map(
    printerEquipment.devices.map((device) => [
      device.id,
      [
        ...printerEquipment.roles
          .get(device.id)!
          .map((state) => summaryOf(state.role, state, printerInfo)),
        summaryOf("card_terminal", readerEquipment.roles.get(device.id)!, readerInfo),
      ],
    ]),
  );
}

export type EquipmentSelection = {
  deviceId: string;
  role: EquipmentRole;
  selection: "default" | { id: string };
  via: "scan" | "list" | "manage";
  takeOver?: boolean;
};

/**
 * Sets one of the device's roles to Use default or to an item, taking it over from another device
 * only by a scan or a confirmed list choice. Refuses, writing nothing, an item the device may not
 * newly choose, a reader another device has a payment in progress on, and a held item otherwise.
 */
export async function selectDeviceEquipment(
  tx: Transaction,
  input: EquipmentSelection,
): Promise<void> {
  const { deviceId, role, selection, via } = input;
  const takeOver = input.takeOver === true;
  const result =
    role === "card_terminal"
      ? await selectDeviceReader(tx, { deviceId, selection, via, takeOver })
      : await selectDevicePrinter(tx, { deviceId, role, selection, via, takeOver });
  if (result.ok) return;
  const field = FIELD[role];
  if (result.refusal === "not_permitted") throw new AppError("device.binding_invalid", { field });
  if (result.refusal === "busy") {
    throw new AppError("reader.payment_in_progress", {
      readerId: (selection as { id: string }).id,
    });
  }
  const holder = (await holdersByDevice(tx, [result.holderDeviceId])).get(result.holderDeviceId)!;
  throw new AppError("device.equipment_held", {
    field,
    holderDeviceId: holder.deviceId,
    holderDeviceName: holder.deviceName,
    holderPersonName: holder.personName,
  });
}
