import { and, asc, eq, inArray, isNull, ne, notInArray, or } from "drizzle-orm";
import { devices, nowIso } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { mayTakeOver } from "@waitron/shared";
import type { EquipmentVia } from "@waitron/shared";
import { IN_PROGRESS_PAYMENT_STATES } from "./provider.js";
import { cardReaderHolders } from "./schema/card-reader-holders.js";
import { cardReaders } from "./schema/card-readers.js";
import { deviceCardReaders } from "./schema/device-card-readers.js";
import { deviceProfileCardReaders } from "./schema/device-profile-card-readers.js";
import { payments } from "./schema/payments.js";
import { DEMO_READER_ID } from "./simulator.js";

/** A profile's readers in display order and its default, which is on that list or `null`. */
export type ProfileReaderList = { readerIds: string[]; defaultReaderId: string | null };

/** The device's stored reader choice, its profile default and who holds each, with what it pays on. */
export type ReaderRoleState = {
  chosenId: string | null;
  chosenHolderDeviceId: string | null;
  defaultId: string | null;
  defaultHolderDeviceId: string | null;
  resolvedId: string | null;
};

export type SelectDeviceReaderInput = {
  deviceId: string;
  selection: "default" | { id: string };
  via: EquipmentVia;
  takeOver?: boolean;
};

export type SelectDeviceReaderResult =
  | { ok: true; previousHolderDeviceId: string | null }
  | { ok: false; refusal: "not_permitted" }
  | { ok: false; refusal: "busy" }
  | { ok: false; refusal: "held"; holderDeviceId: string };

export async function readProfileReaderList(
  tx: Transaction,
  profileId: string,
): Promise<ProfileReaderList> {
  const rows = await tx
    .select({
      readerId: deviceProfileCardReaders.readerId,
      isDefault: deviceProfileCardReaders.isDefault,
    })
    .from(deviceProfileCardReaders)
    .where(eq(deviceProfileCardReaders.deviceProfileId, profileId))
    .orderBy(asc(deviceProfileCardReaders.position));
  return {
    readerIds: rows.map((row) => row.readerId),
    defaultReaderId: rows.find((row) => row.isDefault)?.readerId ?? null,
  };
}

/**
 * Replaces the profile's list and default, then clears each of its devices' choices the list no
 * longer offers, acquiring nothing. A default missing from the list is returned as a refusal,
 * writing nothing, because its code belongs to the caller's surface.
 */
export async function setProfileReaderList(
  tx: Transaction,
  profileId: string,
  list: ProfileReaderList,
): Promise<{ ok: true } | { ok: false; refusal: "default_not_listed" }> {
  if (list.defaultReaderId !== null && !list.readerIds.includes(list.defaultReaderId)) {
    return { ok: false, refusal: "default_not_listed" };
  }
  await tx
    .delete(deviceProfileCardReaders)
    .where(eq(deviceProfileCardReaders.deviceProfileId, profileId));
  if (list.readerIds.length > 0) {
    await tx.insert(deviceProfileCardReaders).values(
      list.readerIds.map((readerId, position) => ({
        deviceProfileId: profileId,
        readerId,
        position,
        isDefault: readerId === list.defaultReaderId,
      })),
    );
  }
  await settleProfileReaderDevices(tx, profileId);
  return { ok: true };
}

/** The device holding the reader, or `null` when nobody does. */
export async function readerHeldBy(tx: Transaction, readerId: string): Promise<string | null> {
  const [row] = await tx
    .select({ deviceId: cardReaderHolders.deviceId })
    .from(cardReaderHolders)
    .where(eq(cardReaderHolders.readerId, readerId));
  return row?.deviceId ?? null;
}

/** Whether a device other than `deviceId` has a payment still in progress on the reader. */
export async function readerPaymentInProgress(
  tx: Transaction,
  readerId: string,
  deviceId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.readerId, readerId),
        inArray(payments.state, IN_PROGRESS_PAYMENT_STATES),
        or(isNull(payments.deviceId), ne(payments.deviceId, deviceId)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** The device's reader role; `null` for an unknown device. */
export async function readReaderRole(
  tx: Transaction,
  deviceId: string,
): Promise<ReaderRoleState | null> {
  return (await readReaderRolesOf(tx, [deviceId])).get(deviceId) ?? null;
}

/** A reader a device's role or its profile's list names, and the device holding it, if any. */
export type ReaderInfo = {
  id: string;
  name: string;
  provider: string;
  active: boolean;
  unpairedAt: string | null;
  holderDeviceId: string | null;
};

/** A reader a profile lists, enabled or not; the demo reader included. */
export type ListedReader = { profileId: string; id: string; isDefault: boolean };

/** What {@link readReaderEquipment} reads; `listed`, empty without `lists`, is in list order. */
export type ReaderEquipment = {
  roles: Map<string, ReaderRoleState>;
  readers: Map<string, ReaderInfo>;
  listed: ListedReader[];
};

async function readReaderRolesOf(
  tx: Transaction,
  deviceIds: readonly string[],
): Promise<Map<string, ReaderRoleState>> {
  if (deviceIds.length === 0) return new Map();
  const deviceRows = await tx
    .select({ id: devices.id, profileId: devices.deviceProfileId })
    .from(devices)
    .where(inArray(devices.id, [...deviceIds]));
  return (await readReaderStates(tx, deviceRows, false)).roles;
}

/**
 * The reader role of each of `deviceRows`, with the readers their roles name and, with `lists`,
 * every reader their profiles list, read with three queries however many devices are given.
 */
export async function readReaderEquipment(
  tx: Transaction,
  deviceRows: readonly { id: string; profileId: string }[],
  options: { lists: boolean },
): Promise<ReaderEquipment> {
  return readReaderStates(tx, deviceRows, options.lists);
}

/** `withLists` also reads every reader the devices' profiles list, not only their defaults. */
async function readReaderStates(
  tx: Transaction,
  deviceRows: readonly { id: string; profileId: string }[],
  withLists: boolean,
): Promise<ReaderEquipment> {
  if (deviceRows.length === 0) return { roles: new Map(), readers: new Map(), listed: [] };
  const choices = await tx
    .select({ deviceId: deviceCardReaders.deviceId, readerId: deviceCardReaders.readerId })
    .from(deviceCardReaders)
    .where(
      inArray(
        deviceCardReaders.deviceId,
        deviceRows.map((device) => device.id),
      ),
    );
  const profileIds = [...new Set(deviceRows.map((device) => device.profileId))];
  const listed = await tx
    .select({
      profileId: deviceProfileCardReaders.deviceProfileId,
      id: deviceProfileCardReaders.readerId,
      isDefault: deviceProfileCardReaders.isDefault,
    })
    .from(deviceProfileCardReaders)
    .where(
      withLists
        ? inArray(deviceProfileCardReaders.deviceProfileId, profileIds)
        : and(
            inArray(deviceProfileCardReaders.deviceProfileId, profileIds),
            eq(deviceProfileCardReaders.isDefault, true),
          ),
    )
    .orderBy(asc(deviceProfileCardReaders.position));
  const readerIds = [
    ...new Set([...choices.map((row) => row.readerId), ...listed.map((row) => row.id)]),
  ];
  const readerRows =
    readerIds.length === 0
      ? []
      : await tx
          .select({
            id: cardReaders.id,
            name: cardReaders.name,
            provider: cardReaders.provider,
            active: cardReaders.active,
            unpairedAt: cardReaders.unpairedAt,
            holderDeviceId: cardReaderHolders.deviceId,
          })
          .from(cardReaders)
          .leftJoin(cardReaderHolders, eq(cardReaderHolders.readerId, cardReaders.id))
          .where(inArray(cardReaders.id, readerIds));
  const choiceOf = new Map(choices.map((row) => [row.deviceId, row.readerId]));
  const defaultOf = new Map(
    listed.filter((row) => row.isDefault).map((row) => [row.profileId, row.id]),
  );
  const readers = new Map(readerRows.map((row) => [row.id, row]));
  const holder = (id: string | null) =>
    id === null ? null : (readers.get(id)?.holderDeviceId ?? null);
  const roles = new Map(
    deviceRows.map((device) => {
      const chosenId = choiceOf.get(device.id) ?? null;
      const defaultId = defaultOf.get(device.profileId) ?? null;
      const chosenHolderDeviceId = holder(chosenId);
      const defaultHolderDeviceId = holder(defaultId);
      // Every reader is portable: it pays only for the device holding it, chosen or the default.
      const resolvedId =
        chosenId !== null
          ? chosenHolderDeviceId === device.id
            ? chosenId
            : null
          : defaultHolderDeviceId === device.id
            ? defaultId
            : null;
      return [
        device.id,
        { chosenId, chosenHolderDeviceId, defaultId, defaultHolderDeviceId, resolvedId },
      ] as const;
    }),
  );
  return { roles, readers, listed: withLists ? listed : [] };
}

/** The reader the device pays on, enabled or not; `null` for none. */
export async function resolveDeviceReaderId(
  tx: Transaction,
  deviceId: string,
): Promise<string | null> {
  return (await readReaderRole(tx, deviceId))?.resolvedId ?? null;
}

/**
 * Sets the device to Use default or to a reader it may newly choose. A reader another device has a
 * payment in progress on is refused before anything else, so nobody is asked to confirm a takeover
 * that would then be refused. A reader another device holds is refused unless taken by a scan or a
 * confirmed list choice, never by a manager; taking it clears the previous holder's choice of it,
 * and that device acquires nothing.
 */
export async function selectDeviceReader(
  tx: Transaction,
  input: SelectDeviceReaderInput,
): Promise<SelectDeviceReaderResult> {
  const { deviceId, selection } = input;
  const [device] = await tx
    .select({ profileId: devices.deviceProfileId })
    .from(devices)
    .where(eq(devices.id, deviceId));
  if (device === undefined) return { ok: false, refusal: "not_permitted" };
  let previousHolderDeviceId: string | null = null;
  if (selection === "default") {
    await tx.delete(deviceCardReaders).where(eq(deviceCardReaders.deviceId, deviceId));
  } else {
    const [reader] = await tx
      .select({ id: cardReaders.id })
      .from(deviceProfileCardReaders)
      .innerJoin(cardReaders, eq(cardReaders.id, deviceProfileCardReaders.readerId))
      .where(
        and(
          eq(deviceProfileCardReaders.deviceProfileId, device.profileId),
          eq(cardReaders.id, selection.id),
          eq(cardReaders.active, true),
          isNull(cardReaders.unpairedAt),
          ne(cardReaders.id, DEMO_READER_ID),
        ),
      );
    if (reader === undefined) return { ok: false, refusal: "not_permitted" };
    if (await readerPaymentInProgress(tx, reader.id, deviceId)) {
      return { ok: false, refusal: "busy" };
    }
    const holder = await readerHeldBy(tx, reader.id);
    if (holder !== null && holder !== deviceId) {
      if (!mayTakeOver(input.via, input.takeOver)) {
        return { ok: false, refusal: "held", holderDeviceId: holder };
      }
      previousHolderDeviceId = holder;
    }
    await tx
      .insert(cardReaderHolders)
      .values({ readerId: reader.id, deviceId })
      .onConflictDoUpdate({
        target: cardReaderHolders.readerId,
        set: { deviceId, heldAt: nowIso() },
      });
    if (previousHolderDeviceId !== null) {
      await tx
        .delete(deviceCardReaders)
        .where(
          and(
            eq(deviceCardReaders.deviceId, previousHolderDeviceId),
            eq(deviceCardReaders.readerId, reader.id),
          ),
        );
      await settleDeviceReader(tx, previousHolderDeviceId, { acquire: false });
    }
    await tx
      .insert(deviceCardReaders)
      .values({ deviceId, readerId: reader.id })
      .onConflictDoUpdate({ target: deviceCardReaders.deviceId, set: { readerId: reader.id } });
  }
  await settleDeviceReader(tx, deviceId, { acquire: true });
  return { ok: true, previousHolderDeviceId };
}

/**
 * With `acquire`, takes the device's chosen reader, or on Use default the profile default, when it
 * is free: nobody holds it and no other device has a payment in progress on it; a chosen reader
 * that is not free puts the device back on Use default. Then lets go of every reader the device
 * holds but no longer uses.
 */
export async function settleDeviceReader(
  tx: Transaction,
  deviceId: string,
  options: { acquire: boolean },
): Promise<void> {
  const state = await readReaderRole(tx, deviceId);
  if (state === null) return;
  if (options.acquire && state.chosenId !== null && state.chosenHolderDeviceId !== deviceId) {
    const free =
      state.chosenHolderDeviceId === null &&
      !(await readerPaymentInProgress(tx, state.chosenId, deviceId));
    if (free) {
      await tx.insert(cardReaderHolders).values({ readerId: state.chosenId, deviceId });
    } else {
      await tx.delete(deviceCardReaders).where(eq(deviceCardReaders.deviceId, deviceId));
      state.chosenId = null;
    }
  }
  const used = state.chosenId ?? state.defaultId;
  if (
    options.acquire &&
    state.chosenId === null &&
    state.defaultId !== null &&
    state.defaultHolderDeviceId === null &&
    !(await readerPaymentInProgress(tx, state.defaultId, deviceId))
  ) {
    await tx
      .insert(cardReaderHolders)
      .values({ readerId: state.defaultId, deviceId })
      .onConflictDoNothing({ target: cardReaderHolders.readerId });
  }
  await tx
    .delete(cardReaderHolders)
    .where(
      used === null
        ? eq(cardReaderHolders.deviceId, deviceId)
        : and(eq(cardReaderHolders.deviceId, deviceId), ne(cardReaderHolders.readerId, used)),
    );
}

/** Lets go of every reader the device holds; keeps its choice. */
export async function releaseDeviceReader(tx: Transaction, deviceId: string): Promise<void> {
  await tx.delete(cardReaderHolders).where(eq(cardReaderHolders.deviceId, deviceId));
}

/** Puts the device back on Use default when its profile no longer lists its chosen reader. */
export async function clearUnlistedReaderChoice(tx: Transaction, deviceId: string): Promise<void> {
  const [device] = await tx
    .select({ profileId: devices.deviceProfileId })
    .from(devices)
    .where(eq(devices.id, deviceId));
  if (device === undefined) return;
  const listed = (await readProfileReaderList(tx, device.profileId)).readerIds;
  await tx
    .delete(deviceCardReaders)
    .where(
      listed.length === 0
        ? eq(deviceCardReaders.deviceId, deviceId)
        : and(
            eq(deviceCardReaders.deviceId, deviceId),
            notInArray(deviceCardReaders.readerId, listed),
          ),
    );
}

/**
 * After the profile's list changes: clears each of its devices' choices no longer listed (a
 * disabled listed reader stays chosen) and lets go of what they no longer use, acquiring nothing.
 */
export async function settleProfileReaderDevices(
  tx: Transaction,
  profileId: string,
): Promise<void> {
  const onProfile = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.deviceProfileId, profileId));
  if (onProfile.length === 0) return;
  const deviceIds = onProfile.map((device) => device.id);
  const list = await readProfileReaderList(tx, profileId);
  await tx
    .delete(deviceCardReaders)
    .where(
      list.readerIds.length === 0
        ? inArray(deviceCardReaders.deviceId, deviceIds)
        : and(
            inArray(deviceCardReaders.deviceId, deviceIds),
            notInArray(deviceCardReaders.readerId, list.readerIds),
          ),
    );
  const choiceOf = new Map(
    (
      await tx
        .select({ deviceId: deviceCardReaders.deviceId, readerId: deviceCardReaders.readerId })
        .from(deviceCardReaders)
        .where(inArray(deviceCardReaders.deviceId, deviceIds))
    ).map((row) => [row.deviceId, row.readerId]),
  );
  const held = await tx
    .select({ readerId: cardReaderHolders.readerId, deviceId: cardReaderHolders.deviceId })
    .from(cardReaderHolders)
    .where(inArray(cardReaderHolders.deviceId, deviceIds));
  // As settleDeviceReader without acquiring: a device keeps only the reader it uses.
  const released = held
    .filter((row) => row.readerId !== (choiceOf.get(row.deviceId) ?? list.defaultReaderId))
    .map((row) => row.readerId);
  if (released.length > 0) {
    await tx.delete(cardReaderHolders).where(inArray(cardReaderHolders.readerId, released));
  }
}
