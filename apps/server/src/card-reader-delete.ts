// Side-effect only: the registry for `reader.not_found`, `reader.provider_disconnected` and
// `reader.unpair_failed`; `@waitron/payments` declares `reader.payment_in_progress`.
import "./errors.js";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  AppError,
  type DeleteImpact,
  type ErrorParams,
  type DeleteImpactItem,
  type DeleteImpactRefusal,
  type DeleteTarget,
} from "@waitron/shared";
import { deviceProfiles, devices, type Transaction } from "@waitron/db";
import {
  cardProviderById,
  cardReaderHolders,
  cardReaders,
  DEMO_READER_ID,
  deviceCardReaders,
  deviceProfileCardReaders,
  IN_PROGRESS_PAYMENT_STATES,
  payments,
  type CardProviderContribution,
} from "@waitron/payments";
import { tenantCredentials } from "@waitron/credentials";
import { distinctTargets, named } from "./delete-impact.js";

export type CardReaderDeletePlan = {
  impact: DeleteImpact;
  provider: string;
  providerRef: string;
  /** Still paired at a provider whose seat can unpair: the delete unpairs it there first. */
  unpairAtProvider: boolean;
};

type RefusalCode = "reader.payment_in_progress" | "reader.provider_disconnected";
type Refused = { refusal: DeleteImpactRefusal; error: AppError };

/** A refusal as the impact reports it, beside the error a delete throws for it. */
function refused<C extends RefusalCode>(
  code: C,
  params: ErrorParams[C],
  targets: DeleteTarget[],
): Refused {
  return { refusal: { code, params, targets }, error: new AppError(code, params) };
}

/** The impact read, step (a) and the delete all call this, so each acts on exactly what it reports. */
async function cardReaderDeleteRules(
  tx: Transaction,
  seats: readonly CardProviderContribution[],
  id: string,
): Promise<{ plan: CardReaderDeletePlan; refusals: Refused[] }> {
  const [reader] = await tx
    .select({
      id: cardReaders.id,
      name: cardReaders.name,
      provider: cardReaders.provider,
      providerRef: cardReaders.providerRef,
      unpairedAt: cardReaders.unpairedAt,
    })
    .from(cardReaders)
    .where(and(eq(cardReaders.id, id), isNull(cardReaders.deletedAt)));
  if (reader === undefined || id === DEMO_READER_ID) throw new AppError("reader.not_found", { id });

  const busy = await tx
    .select({ id: devices.id, name: devices.label })
    .from(payments)
    .leftJoin(devices, eq(devices.id, payments.deviceId))
    .where(and(eq(payments.readerId, id), inArray(payments.state, IN_PROGRESS_PAYMENT_STATES)));
  // An already-unpaired reader is deleted without consulting its provider (spec), so the seat is
  // looked up only while it is still paired.
  const seat = reader.unpairedAt === null ? cardProviderById(seats, reader.provider) : undefined;
  const unpairAtProvider = seat?.readers.canUnpair === true;
  const connected =
    seat === undefined ||
    !unpairAtProvider ||
    (
      await tx
        .select({ purpose: tenantCredentials.purpose })
        .from(tenantCredentials)
        .where(eq(tenantCredentials.purpose, seat.credentialPurpose))
    ).length > 0;

  const refusals: Refused[] = [];
  if (busy.length > 0) {
    const devicesPaying = busy.flatMap((row) =>
      row.id === null ? [] : [{ id: row.id, name: row.name! }],
    );
    refusals.push(
      refused("reader.payment_in_progress", { readerId: id }, distinctTargets(devicesPaying)),
    );
  }
  if (!connected)
    refusals.push(refused("reader.provider_disconnected", { providerId: reader.provider }, []));

  const choosing = await tx
    .select({ id: devices.id, name: devices.label })
    .from(deviceCardReaders)
    .innerJoin(devices, eq(devices.id, deviceCardReaders.deviceId))
    .where(eq(deviceCardReaders.readerId, id));
  // The reader list's "In use by" rule (`payments-api.ts`): active devices with no choice of their
  // own, whose profile's default is this reader.
  const inheriting = await tx
    .select({ id: devices.id, name: devices.label })
    .from(devices)
    .innerJoin(
      deviceProfileCardReaders,
      and(
        eq(deviceProfileCardReaders.deviceProfileId, devices.deviceProfileId),
        eq(deviceProfileCardReaders.readerId, id),
        eq(deviceProfileCardReaders.isDefault, true),
      ),
    )
    .leftJoin(deviceCardReaders, eq(deviceCardReaders.deviceId, devices.id))
    .where(and(eq(devices.active, true), isNull(deviceCardReaders.deviceId)));
  const listed = await tx
    .select({
      id: deviceProfiles.id,
      name: deviceProfiles.name,
      isDefault: deviceProfileCardReaders.isDefault,
    })
    .from(deviceProfileCardReaders)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, deviceProfileCardReaders.deviceProfileId))
    .where(eq(deviceProfileCardReaders.readerId, id));
  const holders = await tx
    .select({ id: devices.id, name: devices.label })
    .from(cardReaderHolders)
    .innerJoin(devices, eq(devices.id, cardReaderHolders.deviceId))
    .where(eq(cardReaderHolders.readerId, id));

  const profiles = (defaultOnly: boolean): DeleteTarget[] =>
    listed
      .filter((row) => !defaultOnly || row.isDefault)
      .map(({ id: profileId, name }) => ({ id: profileId, name }));
  const ends: DeleteImpactItem[] = unpairAtProvider
    ? [named("provider_pairing", [{ id: reader.provider, name: reader.provider }])]
    : [];
  const removes: DeleteImpactItem[] = [
    named("device_reader", choosing),
    named("device_reader_default", inheriting),
    named("profile_reader", profiles(false)),
    named("profile_reader_default", profiles(true)),
    named("reader_holder", holders),
  ];
  return {
    plan: {
      impact: {
        target: { id: reader.id, name: reader.name },
        refusals: refusals.map(({ refusal }) => refusal),
        ends,
        removes: removes.filter((item) => item.count > 0),
      },
      provider: reader.provider,
      providerRef: reader.providerRef,
      unpairAtProvider,
    },
    refusals,
  };
}

/** The rules, throwing the first refusal's error. */
async function unrefusedRules(
  tx: Transaction,
  seats: readonly CardProviderContribution[],
  id: string,
): Promise<CardReaderDeletePlan> {
  const { plan, refusals } = await cardReaderDeleteRules(tx, seats, id);
  if (refusals[0] !== undefined) throw refusals[0].error;
  return plan;
}

/** What deleting the reader would refuse, end and remove now; `reader.not_found` once deleted. */
export async function readCardReaderDeleteImpact(
  tx: Transaction,
  seats: readonly CardProviderContribution[],
  id: string,
): Promise<DeleteImpact> {
  return (await cardReaderDeleteRules(tx, seats, id)).plan.impact;
}

/**
 * Step (a): the rules, throwing the first refusal's code; when `unpairAtProvider`, also switches
 * the reader off (active false, disabled_at set if null) before the provider is called, so a pay
 * that starts afterwards does not find it (`resolvePayReader` reads active readers only,
 * `till-api.ts:316`).
 */
export async function prepareCardReaderDelete(
  tx: Transaction,
  seats: readonly CardProviderContribution[],
  id: string,
  now = new Date(),
): Promise<CardReaderDeletePlan> {
  const plan = await unrefusedRules(tx, seats, id);
  if (plan.unpairAtProvider) {
    await tx
      .update(cardReaders)
      .set({
        active: false,
        disabledAt: sql`coalesce(${cardReaders.disabledAt}, ${now.toISOString()})`,
      })
      .where(and(eq(cardReaders.id, id), isNull(cardReaders.deletedAt)));
  }
  return plan;
}

/** Unpair's local write: active false, disabled_at and unpaired_at = at, undeleted rows only. */
export async function markCardReaderUnpaired(
  tx: Transaction,
  id: string,
  at: string,
): Promise<void> {
  await tx
    .update(cardReaders)
    .set({ active: false, disabledAt: at, unpairedAt: at })
    .where(and(eq(cardReaders.id, id), isNull(cardReaders.deletedAt)));
}

/**
 * Step (c): recomputes the impact on the caller's transaction and acts on it — refuses, or removes
 * every link naming the reader and keeps the row, switched off and marked deleted. A reader its
 * provider must still unpair is refused `reader.unpair_failed`: the caller unpairs it first.
 */
export async function deleteCardReader(
  tx: Transaction,
  seats: readonly CardProviderContribution[],
  id: string,
  now = new Date(),
): Promise<DeleteImpact> {
  const plan = await unrefusedRules(tx, seats, id);
  if (plan.unpairAtProvider)
    throw new AppError("reader.unpair_failed", { providerId: plan.provider });
  await tx.delete(deviceCardReaders).where(eq(deviceCardReaders.readerId, id));
  await tx.delete(deviceProfileCardReaders).where(eq(deviceProfileCardReaders.readerId, id));
  await tx.delete(cardReaderHolders).where(eq(cardReaderHolders.readerId, id));
  await tx
    .update(cardReaders)
    .set({
      active: false,
      deletedAt: now.toISOString(),
      disabledAt: sql`coalesce(${cardReaders.disabledAt}, ${now.toISOString()})`,
    })
    .where(and(eq(cardReaders.id, id), isNull(cardReaders.deletedAt)));
  return plan.impact;
}
