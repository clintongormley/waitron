import { and, desc, eq, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { deviceProfiles, devices } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { mayTakeOver } from "@waitron/shared";
import type { EquipmentVia } from "@waitron/shared";
import { IN_PROGRESS_PAYMENT_STATES } from "./provider.js";
import { cardReaders } from "./schema/card-readers.js";
import { payments } from "./schema/payments.js";

export type ProfileReaderList = { readerIds: string[]; defaultReaderId: string | null };
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
  | { ok: false; refusal: "deleted" }
  | { ok: false; refusal: "busy" }
  | { ok: false; refusal: "held"; holderDeviceId: string };

export async function readProfileReaderList(
  tx: Transaction,
  profileId: string,
): Promise<ProfileReaderList> {
  const [row] = await tx
    .select({ list: deviceProfiles.cardReaders })
    .from(deviceProfiles)
    .where(eq(deviceProfiles.id, profileId));
  return { readerIds: row?.list.ids ?? [], defaultReaderId: row?.list.defaultId ?? null };
}

export async function isKnownReader(tx: Transaction, readerId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: cardReaders.id })
    .from(cardReaders)
    .where(and(eq(cardReaders.id, readerId), isNull(cardReaders.deletedAt)));
  return row !== undefined;
}

export async function setProfileReaderList(
  tx: Transaction,
  profileId: string,
  list: ProfileReaderList,
): Promise<
  | { ok: true }
  | { ok: false; refusal: "duplicate" | "default_not_listed" }
  | { ok: false; refusal: "unknown_reader"; readerId: string }
> {
  if (new Set(list.readerIds).size !== list.readerIds.length)
    return { ok: false, refusal: "duplicate" };
  for (const readerId of list.readerIds) {
    if (!(await isKnownReader(tx, readerId)))
      return { ok: false, refusal: "unknown_reader", readerId };
  }
  if (list.defaultReaderId !== null && !list.readerIds.includes(list.defaultReaderId))
    return { ok: false, refusal: "default_not_listed" };
  const oldDefault =
    list.defaultReaderId === null
      ? null
      : (await readProfileReaderList(tx, profileId)).defaultReaderId;
  // Settling the profile releases the old hold and clears choices removed from the list.
  const oldHolder = oldDefault === null ? null : await readerHeldBy(tx, oldDefault);
  await tx
    .update(deviceProfiles)
    .set({ cardReaders: { ids: list.readerIds, defaultId: list.defaultReaderId } })
    .where(eq(deviceProfiles.id, profileId));
  await settleProfileReaderDevices(tx, profileId);
  if (list.defaultReaderId !== null) {
    const [first, second] = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(
        and(
          eq(devices.deviceProfileId, profileId),
          eq(devices.active, true),
          isNull(devices.cardReaderId),
        ),
      )
      .orderBy(oldHolder === null ? devices.id : desc(eq(devices.id, oldHolder)))
      .limit(2);
    if (first !== undefined && (first.id === oldHolder || second === undefined))
      await settleDeviceReader(tx, first.id, { acquire: true });
  }
  return { ok: true };
}

export async function appendReaderToProfiles(
  tx: Transaction,
  readerId: string,
  profileIds: readonly string[],
): Promise<void> {
  if (profileIds.length === 0) return;
  const profiles = await tx
    .select({ id: deviceProfiles.id, list: deviceProfiles.cardReaders })
    .from(deviceProfiles)
    .where(inArray(deviceProfiles.id, [...profileIds]));
  for (const profile of profiles) {
    const ids = profile.list.ids ?? [];
    if (ids.includes(readerId)) continue;
    await tx
      .update(deviceProfiles)
      .set({ cardReaders: { ids: [...ids, readerId], defaultId: profile.list.defaultId ?? null } })
      .where(eq(deviceProfiles.id, profile.id));
  }
}

export async function readerHeldBy(tx: Transaction, readerId: string): Promise<string | null> {
  const [row] = await tx
    .select({ deviceId: cardReaders.heldByDeviceId })
    .from(cardReaders)
    .where(eq(cardReaders.id, readerId));
  return row?.deviceId ?? null;
}

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

export async function readReaderRole(
  tx: Transaction,
  deviceId: string,
): Promise<ReaderRoleState | null> {
  const rows = await tx
    .select({ id: devices.id, profileId: devices.deviceProfileId })
    .from(devices)
    .where(eq(devices.id, deviceId));
  return (await readReaderStates(tx, rows, false)).roles.get(deviceId) ?? null;
}

export type ReaderInfo = {
  id: string;
  name: string;
  provider: string;
  active: boolean;
  unpairedAt: string | null;
  printsOwnSlipAutomatically: boolean;
  holderDeviceId: string | null;
};
export type ListedReader = { profileId: string; id: string; isDefault: boolean };
export type ReaderEquipment = {
  roles: Map<string, ReaderRoleState>;
  readers: Map<string, ReaderInfo>;
  listed: ListedReader[];
};

export async function readReaderEquipment(
  tx: Transaction,
  deviceRows: readonly { id: string; profileId: string }[],
  options: { lists: boolean },
): Promise<ReaderEquipment> {
  return readReaderStates(tx, deviceRows, options.lists);
}

async function readReaderStates(
  tx: Transaction,
  deviceRows: readonly { id: string; profileId: string }[],
  withLists: boolean,
): Promise<ReaderEquipment> {
  if (deviceRows.length === 0) return { roles: new Map(), readers: new Map(), listed: [] };
  const choices = await tx
    .select({ deviceId: devices.id, readerId: devices.cardReaderId })
    .from(devices)
    .where(
      inArray(
        devices.id,
        deviceRows.map((d) => d.id),
      ),
    );
  const profiles = await tx
    .select({ profileId: deviceProfiles.id, list: deviceProfiles.cardReaders })
    .from(deviceProfiles)
    .where(inArray(deviceProfiles.id, [...new Set(deviceRows.map((d) => d.profileId))]));
  const listed = profiles.flatMap(({ profileId, list }) =>
    (withLists ? (list.ids ?? []) : list.defaultId ? [list.defaultId] : []).map((id) => ({
      profileId,
      id,
      isDefault: id === list.defaultId,
    })),
  );
  const readerIds = [
    ...new Set([
      ...choices.flatMap((c) => (c.readerId === null ? [] : [c.readerId])),
      ...listed.map((r) => r.id),
    ]),
  ];
  const rows =
    readerIds.length === 0
      ? []
      : await tx
          .select({
            id: cardReaders.id,
            name: cardReaders.name,
            provider: cardReaders.provider,
            active: sql<boolean>`${cardReaders.disabledAt} is null`.mapWith(Boolean),
            unpairedAt: cardReaders.unpairedAt,
            printsOwnSlipAutomatically: cardReaders.printsOwnSlipAutomatically,
            holderDeviceId: cardReaders.heldByDeviceId,
          })
          .from(cardReaders)
          .where(inArray(cardReaders.id, readerIds));
  const readers = new Map(rows.map((r) => [r.id, r]));
  const choiceOf = new Map(choices.map((c) => [c.deviceId, c.readerId]));
  const defaultOf = new Map(profiles.map((p) => [p.profileId, p.list.defaultId ?? null]));
  const holder = (id: string | null) =>
    id === null ? null : (readers.get(id)?.holderDeviceId ?? null);
  const roles = new Map(
    deviceRows.map((d) => {
      const chosenId = choiceOf.get(d.id) ?? null;
      const defaultId = defaultOf.get(d.profileId) ?? null;
      const chosenHolderDeviceId = holder(chosenId);
      const defaultHolderDeviceId = holder(defaultId);
      // A portable reader pays only for the device holding it, chosen or the profile default.
      const resolvedId =
        chosenId !== null
          ? chosenHolderDeviceId === d.id
            ? chosenId
            : null
          : defaultHolderDeviceId === d.id
            ? defaultId
            : null;
      return [
        d.id,
        { chosenId, defaultId, chosenHolderDeviceId, defaultHolderDeviceId, resolvedId },
      ] as const;
    }),
  );
  return { roles, readers, listed: withLists ? listed : [] };
}

export async function resolveDeviceReaderId(
  tx: Transaction,
  deviceId: string,
): Promise<string | null> {
  return (await readReaderRole(tx, deviceId))?.resolvedId ?? null;
}

export async function selectDeviceReader(
  tx: Transaction,
  input: SelectDeviceReaderInput,
): Promise<SelectDeviceReaderResult> {
  const { deviceId, selection } = input;
  if (selection !== "default") {
    const [row] = await tx
      .select({ deletedAt: cardReaders.deletedAt })
      .from(cardReaders)
      .where(eq(cardReaders.id, selection.id));
    if (row?.deletedAt != null) return { ok: false, refusal: "deleted" };
  }
  const [device] = await tx
    .select({ profileId: devices.deviceProfileId })
    .from(devices)
    .where(eq(devices.id, deviceId));
  if (device === undefined) return { ok: false, refusal: "not_permitted" };
  let previousHolderDeviceId: string | null = null;
  if (selection === "default") {
    await tx.update(devices).set({ cardReaderId: null }).where(eq(devices.id, deviceId));
  } else {
    const listed = (await readProfileReaderList(tx, device.profileId)).readerIds.includes(
      selection.id,
    );
    const [reader] = listed
      ? await tx
          .select({ id: cardReaders.id })
          .from(cardReaders)
          .where(
            and(
              eq(cardReaders.id, selection.id),
              isNull(cardReaders.disabledAt),
              isNull(cardReaders.unpairedAt),
            ),
          )
      : [];
    if (reader === undefined) return { ok: false, refusal: "not_permitted" };
    // Refuse busy before asking staff to confirm a takeover that would then be refused.
    if (await readerPaymentInProgress(tx, reader.id, deviceId))
      return { ok: false, refusal: "busy" };
    const holder = await readerHeldBy(tx, reader.id);
    if (holder !== null && holder !== deviceId) {
      if (!mayTakeOver(input.via, input.takeOver))
        return { ok: false, refusal: "held", holderDeviceId: holder };
      previousHolderDeviceId = holder;
    }
    await tx
      .update(cardReaders)
      .set({ heldByDeviceId: deviceId })
      .where(eq(cardReaders.id, reader.id));
    if (previousHolderDeviceId !== null) {
      await tx
        .update(devices)
        .set({ cardReaderId: null })
        .where(and(eq(devices.id, previousHolderDeviceId), eq(devices.cardReaderId, reader.id)));
      await settleDeviceReader(tx, previousHolderDeviceId, { acquire: false });
    }
    await tx.update(devices).set({ cardReaderId: reader.id }).where(eq(devices.id, deviceId));
  }
  await settleDeviceReader(tx, deviceId, { acquire: true });
  return { ok: true, previousHolderDeviceId };
}

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
      await tx
        .update(cardReaders)
        .set({ heldByDeviceId: deviceId })
        .where(and(eq(cardReaders.id, state.chosenId), isNull(cardReaders.heldByDeviceId)));
    } else {
      await tx.update(devices).set({ cardReaderId: null }).where(eq(devices.id, deviceId));
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
      .update(cardReaders)
      .set({ heldByDeviceId: deviceId })
      .where(and(eq(cardReaders.id, state.defaultId), isNull(cardReaders.heldByDeviceId)));
  }
  await tx
    .update(cardReaders)
    .set({ heldByDeviceId: null })
    .where(
      used === null
        ? eq(cardReaders.heldByDeviceId, deviceId)
        : and(eq(cardReaders.heldByDeviceId, deviceId), ne(cardReaders.id, used)),
    );
}

export async function releaseDeviceReader(tx: Transaction, deviceId: string): Promise<void> {
  await tx
    .update(cardReaders)
    .set({ heldByDeviceId: null })
    .where(eq(cardReaders.heldByDeviceId, deviceId));
}

/**
 * The reader column a device choosing `cardReaderId` would put back on Use default on
 * `profileId`, writing nothing: its choice, when that profile does not list it.
 */
export async function readerChoiceClearedOnProfile(
  tx: Transaction,
  cardReaderId: string | null,
  profileId: string,
): Promise<{ cardReaderId?: null }> {
  if (cardReaderId === null) return {};
  const { readerIds } = await readProfileReaderList(tx, profileId);
  return readerIds.includes(cardReaderId) ? {} : { cardReaderId: null };
}

export async function clearUnlistedReaderChoice(tx: Transaction, deviceId: string): Promise<void> {
  const [device] = await tx
    .select({ profileId: devices.deviceProfileId, cardReaderId: devices.cardReaderId })
    .from(devices)
    .where(eq(devices.id, deviceId));
  if (device === undefined) return;
  const cleared = await readerChoiceClearedOnProfile(tx, device.cardReaderId, device.profileId);
  if (Object.keys(cleared).length > 0) {
    await tx.update(devices).set(cleared).where(eq(devices.id, deviceId));
  }
}

export async function settleProfileReaderDevices(
  tx: Transaction,
  profileId: string,
): Promise<void> {
  const onProfile = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.deviceProfileId, profileId));
  if (onProfile.length === 0) return;
  const ids = onProfile.map((d) => d.id);
  const list = await readProfileReaderList(tx, profileId);
  await tx
    .update(devices)
    .set({ cardReaderId: null })
    .where(
      list.readerIds.length === 0
        ? inArray(devices.id, ids)
        : and(inArray(devices.id, ids), notInArray(devices.cardReaderId, list.readerIds)),
    );
  const choices = await tx
    .select({ deviceId: devices.id, readerId: devices.cardReaderId })
    .from(devices)
    .where(inArray(devices.id, ids));
  const choiceOf = new Map(choices.map((d) => [d.deviceId, d.readerId]));
  const held = await tx
    .select({ readerId: cardReaders.id, deviceId: cardReaders.heldByDeviceId })
    .from(cardReaders)
    .where(inArray(cardReaders.heldByDeviceId, ids));
  const release = held
    .filter((r) => r.readerId !== (choiceOf.get(r.deviceId!) ?? list.defaultReaderId))
    .map((r) => r.readerId);
  if (release.length > 0)
    await tx
      .update(cardReaders)
      .set({ heldByDeviceId: null })
      .where(inArray(cardReaders.id, release));
}
