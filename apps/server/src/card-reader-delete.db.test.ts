import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  deviceProfiles,
  devices,
  locations,
  withTransaction,
  workingOrders,
  type Database,
  type Transaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { loadKeyRing, putCredential, type KeyRing } from "@waitron/credentials";
import { createStripeCardProvider, type MakeStripe } from "@waitron/payments-stripe";
import {
  DEMO_READER_ID,
  DEMO_READER_REF,
  cardReaderHolders,
  cardReaders,
  deviceCardReaders,
  deviceProfileCardReaders,
  payments,
  type CardProviderContribution,
} from "@waitron/payments";
import "./errors.js";
import {
  deleteCardReader,
  markCardReaderUnpaired,
  prepareCardReaderDelete,
  readCardReaderDeleteImpact,
  startCardReaderDelete,
  type CardReaderDeleteOptions,
} from "./card-reader-delete.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const NOW = new Date("2026-10-10T10:00:00.000Z");
const EARLIER = "2026-10-05T08:00:00.000Z";
const UNPAIRED = "2026-10-01T09:00:00.000Z";

/** Answers the account read `connect` makes; nothing else in this file reaches Stripe. */
const fakeMakeStripe = (() => ({
  accounts: { retrieve: async () => ({ id: "acct_test", settings: {} }) },
})) as unknown as MakeStripe;
const stripe: CardProviderContribution = createStripeCardProvider(fakeMakeStripe);
const seats: readonly CardProviderContribution[] = [stripe];
const unpairing: CardProviderContribution = {
  ...stripe,
  readers: { ...stripe.readers, canUnpair: true },
};

type Rows = Record<string, unknown>[];
type Snapshot = Record<string, Rows>;

const sorted = (rows: Rows): Rows =>
  rows
    .map((row) => ({ key: JSON.stringify(row), row }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ row }) => row);

/** Every table's rows in a fixed order, so two snapshots compare by value. */
async function snapshot(): Promise<Snapshot> {
  const tables = await suite.db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
  );
  const out: Snapshot = {};
  for (const { name } of tables.rows) {
    out[name] = sorted(
      (await suite.db.execute(sql`select * from ${sql.identifier(name)}`)).rows as Rows,
    );
  }
  return out;
}

/** `before` with the reader's own row changed by `change` and every link naming it removed. */
function withoutReaderLinks(
  before: Snapshot,
  readerId: string,
  change: (row: Record<string, unknown>) => Record<string, unknown>,
): Snapshot {
  const unlinked = (rows: Rows) => rows.filter((row) => row.reader_id !== readerId);
  return {
    ...before,
    card_readers: sorted(
      before.card_readers!.map((row) => (row.id === readerId ? change(row) : row)),
    ),
    device_card_readers: unlinked(before.device_card_readers!),
    device_profile_card_readers: unlinked(before.device_profile_card_readers!),
    card_reader_holders: unlinked(before.card_reader_holders!),
  };
}

/** `before` with only the reader's own row changed by `change`. */
function withReaderRow(
  before: Snapshot,
  readerId: string,
  change: (row: Record<string, unknown>) => Record<string, unknown>,
): Snapshot {
  return {
    ...before,
    card_readers: sorted(
      before.card_readers!.map((row) => (row.id === readerId ? change(row) : row)),
    ),
  };
}

type ReaderOptions = {
  provider?: string;
  unpairedAt?: string | null;
  active?: boolean;
  disabledAt?: string | null;
};

/**
 * Reader R "Lector barra" and control reader Q on two profiles and four devices: Caja 1 chooses R
 * and holds it, Caja 2 takes Sala's default R, Vieja (switched off) chooses R, Caja 3 takes
 * Terraza's default Q and holds Q.
 */
async function seedVenue(options: ReaderOptions = {}) {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Barra", invoiceLocales: ["es-ES"], operationDescription: "Venta" })
    .returning({ id: locations.id });
  const locationId = location!.id;
  const [rRow] = await suite.db
    .insert(cardReaders)
    .values({
      provider: options.provider ?? "stripe",
      providerRef: "tmr_R",
      name: "Lector barra",
      active: options.active ?? true,
      disabledAt: options.disabledAt ?? null,
      unpairedAt: options.unpairedAt === undefined ? UNPAIRED : options.unpairedAt,
    })
    .returning({ id: cardReaders.id });
  const [qRow] = await suite.db
    .insert(cardReaders)
    .values({ provider: "stripe", providerRef: "tmr_Q", name: "Lector terraza" })
    .returning({ id: cardReaders.id });
  const r = rRow!.id;
  const q = qRow!.id;

  const profile = async (name: string) => ({
    id: (
      await suite.db
        .insert(deviceProfiles)
        .values({ name, formFactor: "till" })
        .returning({ id: deviceProfiles.id })
    )[0]!.id,
    name,
  });
  const sala = await profile("Sala");
  const terraza = await profile("Terraza");
  await suite.db.insert(deviceProfileCardReaders).values([
    { deviceProfileId: sala.id, readerId: r, position: 0, isDefault: true },
    { deviceProfileId: sala.id, readerId: q, position: 1, isDefault: false },
    { deviceProfileId: terraza.id, readerId: q, position: 0, isDefault: true },
    { deviceProfileId: terraza.id, readerId: r, position: 1, isDefault: false },
  ]);

  const device = async (name: string, profileId: string, active = true) => ({
    id: (
      await suite.db
        .insert(devices)
        .values({ locationId, deviceProfileId: profileId, label: name, tokenHash: "x", active })
        .returning({ id: devices.id })
    )[0]!.id,
    name,
  });
  const caja1 = await device("Caja 1", sala.id);
  const caja2 = await device("Caja 2", sala.id);
  const vieja = await device("Vieja", terraza.id, false);
  const caja3 = await device("Caja 3", terraza.id);
  await suite.db.insert(deviceCardReaders).values([
    { deviceId: caja1.id, readerId: r },
    { deviceId: vieja.id, readerId: r },
  ]);
  await suite.db.insert(cardReaderHolders).values([
    { readerId: r, deviceId: caja1.id, heldAt: EARLIER },
    { readerId: q, deviceId: caja3.id, heldAt: EARLIER },
  ]);

  let orderNumber = 0;
  const payment = async (
    state: "attempting" | "initiated" | "captured" | "failed" | "voided",
    deviceId: string | null,
  ) => {
    orderNumber += 1;
    const [order] = await suite.db
      .insert(workingOrders)
      .values({ source: "dashboard", locationId, orderNumber })
      .returning({ id: workingOrders.id });
    await suite.db.insert(payments).values({
      workingOrderId: order!.id,
      source: deviceId === null ? "operator_script" : "device",
      deviceId,
      readerId: r,
      provider: "stripe",
      paymentRef: randomUUID(),
      amount: 500,
      state,
    });
  };

  return { r, q, sala, terraza, caja1, caja2, vieja, caja3, payment, device };
}

/** The stored Stripe credential, sealed from the payload the seat's own `connect` returns. */
async function connectStripe(db: Database): Promise<void> {
  const { sealedPayload } = await stripe.connect(
    { environment: "preproduction" },
    {
      secretKey: "sk_test_card_reader_delete",
      webhookSecret: "whsec_test",
      successUrl: "https://example.test/ok",
      cancelUrl: "https://example.test/cancel",
    },
  );
  await withTransaction(db, (tx) =>
    putCredential(tx, RING, { purpose: stripe.credentialPurpose, value: sealedPayload }),
  );
}

const read = (list: readonly CardProviderContribution[], id: string) =>
  withTransaction(suite.db, (tx) => readCardReaderDeleteImpact(tx, list, id));
const remove = (
  list: readonly CardProviderContribution[],
  id: string,
  now = NOW,
  options: CardReaderDeleteOptions = {},
) => withTransaction(suite.db, (tx) => deleteCardReader(tx, list, id, now, options));
const prepare = (
  list: readonly CardProviderContribution[],
  id: string,
  now = NOW,
  options: CardReaderDeleteOptions = {},
) => withTransaction(suite.db, (tx) => prepareCardReaderDelete(tx, list, id, now, options));
const accepted = { acceptRegistrationKept: true };
const kept = {
  key: "provider_registration_kept",
  count: 1,
  targets: [{ id: "stripe", name: "stripe" }],
};

describe("the card reader delete impact", () => {
  it("names every device choice, inherited default, profile list, profile default and holder", async () => {
    const v = await seedVenue();
    expect(await read(seats, v.r)).toEqual({
      target: { id: v.r, name: "Lector barra" },
      refusals: [],
      ends: [],
      removes: [
        { key: "device_reader", count: 2, targets: [v.caja1, v.vieja] },
        { key: "device_reader_default", count: 1, targets: [v.caja2] },
        { key: "profile_reader", count: 2, targets: [v.sala, v.terraza] },
        { key: "profile_reader_default", count: 1, targets: [v.sala] },
        { key: "reader_holder", count: 1, targets: [v.caja1] },
      ],
    });
  });

  it("names no switched-off device under the default it would inherit", async () => {
    const v = await seedVenue();
    const apagada = await v.device("Apagada", v.sala.id, false);
    const impact = await read(seats, v.r);
    expect(impact.removes).toContainEqual({
      key: "device_reader_default",
      count: 1,
      targets: [v.caja2],
    });
    expect(JSON.stringify(impact)).not.toContain(apagada.id);
  });

  it("writes nothing", async () => {
    const v = await seedVenue();
    const before = await snapshot();
    await read(seats, v.r);
    expect(await snapshot()).toEqual(before);
  });

  it("ends the provider pairing of a still-paired reader whose provider can unpair and is connected", async () => {
    const v = await seedVenue({ unpairedAt: null });
    await connectStripe(suite.db);
    const impact = await read([unpairing], v.r);
    expect(impact.refusals).toEqual([]);
    expect(impact.ends).toEqual([
      { key: "provider_pairing", count: 1, targets: [{ id: "stripe", name: "stripe" }] },
    ]);
  });

  it("says a still-paired reader stays registered at a provider that can unpair but is not connected, refusing nothing", async () => {
    const v = await seedVenue({ unpairedAt: null });
    const impact = await read([unpairing], v.r);
    expect(impact.refusals).toEqual([]);
    expect(impact.ends).toEqual([kept]);
  });

  it("shows a payment in progress beside the notice for a disconnected provider", async () => {
    const v = await seedVenue({ unpairedAt: null });
    await v.payment("attempting", v.caja2.id);
    const impact = await read([unpairing], v.r);
    expect(impact.refusals).toEqual([
      { code: "reader.payment_in_progress", params: { readerId: v.r }, targets: [v.caja2] },
    ]);
    expect(impact.ends).toEqual([kept]);
  });

  it("names no pairing for a provider that cannot unpair, connected or not", async () => {
    const v = await seedVenue({ unpairedAt: null });
    const impact = await read(seats, v.r);
    expect(impact.refusals).toEqual([]);
    expect(impact.ends).toEqual([]);
  });
});

describe("deleting a card reader", () => {
  it.each([
    { state: "enabled", active: true, disabledAt: null, expectedDisabledAt: NOW.toISOString() },
    { state: "already disabled", active: false, disabledAt: EARLIER, expectedDisabledAt: EARLIER },
  ])(
    "removes its links, keeps the $state row switched off and marked deleted, and returns the impact it read",
    async ({ active, disabledAt, expectedDisabledAt }) => {
      const v = await seedVenue({ active, disabledAt });
      const impact = await read(seats, v.r);
      const before = await snapshot();

      expect(await remove(seats, v.r)).toEqual(impact);

      expect(await snapshot()).toEqual(
        withoutReaderLinks(before, v.r, (row) => ({
          ...row,
          active: 0,
          deleted_at: NOW.toISOString(),
          disabled_at: expectedDisabledAt,
        })),
      );
      const [row] = await suite.db.select().from(cardReaders).where(eq(cardReaders.id, v.r));
      expect(row!.unpairedAt).toBe(UNPAIRED);
    },
  );

  it("keeps the payment taken on it, joined to the retained row by name", async () => {
    const v = await seedVenue();
    await v.payment("captured", v.caja2.id);
    const before = await snapshot();

    await remove(seats, v.r);

    expect((await snapshot()).payments).toEqual(before.payments);
    await suite.db
      .insert(cardReaders)
      .values({ provider: "stripe", providerRef: "tmr_R", name: "Lector barra" });
    const joined = await suite.db.execute(
      sql`select card_readers.id, card_readers.name from payments
          join card_readers on card_readers.id = payments.reader_id
          where payments.id = ${before.payments![0]!.id}`,
    );
    expect(joined.rows).toEqual([{ id: v.r, name: "Lector barra" }]);
    expect((await suite.db.execute(sql`pragma foreign_key_check`)).rows).toEqual([]);
  });

  it.each(["attempting", "initiated"] as const)(
    "is refused while a payment is %s on it, and writes nothing",
    async (state) => {
      const v = await seedVenue();
      await v.payment(state, v.caja2.id);
      expect((await read(seats, v.r)).refusals).toEqual([
        { code: "reader.payment_in_progress", params: { readerId: v.r }, targets: [v.caja2] },
      ]);
      const before = await snapshot();
      await expect(remove(seats, v.r)).rejects.toMatchObject({
        code: "reader.payment_in_progress",
        params: { readerId: v.r },
      });
      expect(await snapshot()).toEqual(before);
    },
  );

  it("is refused by a payment in progress that names no device", async () => {
    const v = await seedVenue();
    await v.payment("attempting", null);
    expect((await read(seats, v.r)).refusals).toEqual([
      { code: "reader.payment_in_progress", params: { readerId: v.r }, targets: [] },
    ]);
    await expect(remove(seats, v.r)).rejects.toMatchObject({ code: "reader.payment_in_progress" });
  });

  it.each(["captured", "failed", "voided"] as const)(
    "is not refused by a %s payment on it",
    async (state) => {
      const v = await seedVenue();
      await v.payment(state, v.caja2.id);
      expect((await read(seats, v.r)).refusals).toEqual([]);
      await remove(seats, v.r);
      const [row] = await suite.db.select().from(cardReaders).where(eq(cardReaders.id, v.r));
      expect(row!.deletedAt).toBe(NOW.toISOString());
    },
  );

  it("answers reader.unpair_failed for a still-paired reader its provider must unpair, and writes nothing", async () => {
    const v = await seedVenue({ unpairedAt: null });
    await connectStripe(suite.db);
    const before = await snapshot();
    await expect(remove([unpairing], v.r)).rejects.toMatchObject({
      code: "reader.unpair_failed",
      params: { providerId: "stripe" },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("answers reader.provider_disconnected first when that provider has no credential, and writes nothing", async () => {
    const v = await seedVenue({ unpairedAt: null });
    const before = await snapshot();
    await expect(remove([unpairing], v.r)).rejects.toMatchObject({
      code: "reader.provider_disconnected",
      params: { providerId: "stripe" },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("deletes a still-paired reader of a disconnected provider in Waitron only once the notice is accepted, as the impact said", async () => {
    const v = await seedVenue({ unpairedAt: null });
    const impact = await read([unpairing], v.r);
    const before = await snapshot();

    expect(await remove([unpairing], v.r, NOW, accepted)).toEqual(impact);

    expect(await snapshot()).toEqual(
      withoutReaderLinks(before, v.r, (row) => ({
        ...row,
        active: 0,
        deleted_at: NOW.toISOString(),
        disabled_at: NOW.toISOString(),
      })),
    );
    const [row] = await suite.db.select().from(cardReaders).where(eq(cardReaders.id, v.r));
    expect(row!.unpairedAt).toBeNull();
  });

  it("still refuses a payment in progress first when the notice is accepted", async () => {
    const v = await seedVenue({ unpairedAt: null });
    await v.payment("attempting", v.caja2.id);
    const before = await snapshot();
    await expect(remove([unpairing], v.r, NOW, accepted)).rejects.toMatchObject({
      code: "reader.payment_in_progress",
    });
    await expect(remove([unpairing], v.r)).rejects.toMatchObject({
      code: "reader.payment_in_progress",
    });
    expect(await snapshot()).toEqual(before);
  });

  it("never skips a needed unpair because the notice was accepted", async () => {
    const v = await seedVenue({ unpairedAt: null });
    await connectStripe(suite.db);
    const before = await snapshot();
    await expect(remove([unpairing], v.r, NOW, accepted)).rejects.toMatchObject({
      code: "reader.unpair_failed",
      params: { providerId: "stripe" },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("deletes a still-paired reader whose provider cannot unpair, leaving it marked paired", async () => {
    const v = await seedVenue({ unpairedAt: null });
    await remove(seats, v.r);
    const [row] = await suite.db.select().from(cardReaders).where(eq(cardReaders.id, v.r));
    expect(row).toMatchObject({ deletedAt: NOW.toISOString(), unpairedAt: null, active: false });
  });

  it("never looks up the provider of an unpaired reader", async () => {
    const v = await seedVenue({ provider: "gone" });
    expect((await read(seats, v.r)).target).toEqual({ id: v.r, name: "Lector barra" });
    await remove(seats, v.r);
    const [row] = await suite.db.select().from(cardReaders).where(eq(cardReaders.id, v.r));
    expect(row!.deletedAt).toBe(NOW.toISOString());
  });

  it("answers payment.provider_unknown for a still-paired reader no seat serves, and writes nothing", async () => {
    const v = await seedVenue({ provider: "gone", unpairedAt: null });
    const before = await snapshot();
    for (const call of [read, remove, prepare]) {
      await expect(call(seats, v.r)).rejects.toMatchObject({
        code: "payment.provider_unknown",
        params: { providerId: "gone" },
      });
    }
    expect(await snapshot()).toEqual(before);
  });

  it("answers reader.not_found for an unknown, a deleted and the demo reader, and writes nothing", async () => {
    const v = await seedVenue();
    await suite.db.insert(cardReaders).values({
      id: DEMO_READER_ID,
      provider: "simulator",
      providerRef: DEMO_READER_REF,
      name: "Demo card reader",
    });
    await remove(seats, v.r);
    const before = await snapshot();
    for (const id of [randomUUID(), v.r, DEMO_READER_ID]) {
      for (const call of [read, remove, prepare]) {
        await expect(call(seats, id)).rejects.toMatchObject({
          code: "reader.not_found",
          params: { id },
        });
      }
    }
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back every removal when the final write is refused", async () => {
    const v = await seedVenue();
    const before = await snapshot();
    await suite.db.execute(
      sql`create trigger test_delete_failure before update on card_readers
        when new.deleted_at is not null
        begin select raise(abort, 'test_delete_failure'); end`,
    );
    try {
      await expect(remove(seats, v.r)).rejects.toThrow(/test_delete_failure/);
      expect(await snapshot()).toEqual(before);
    } finally {
      await suite.db.execute(sql`drop trigger test_delete_failure`);
    }
  });
});

describe("preparing a card reader delete (step a)", () => {
  it.each([
    { state: "enabled", active: true, disabledAt: null, expectedDisabledAt: NOW.toISOString() },
    { state: "already disabled", active: false, disabledAt: EARLIER, expectedDisabledAt: EARLIER },
  ])(
    "switches off a $state reader its provider will unpair, and changes nothing else",
    async ({ active, disabledAt, expectedDisabledAt }) => {
      const v = await seedVenue({ unpairedAt: null, active, disabledAt });
      await connectStripe(suite.db);
      const impact = await read([unpairing], v.r);
      const before = await snapshot();

      expect(await prepare([unpairing], v.r)).toEqual({
        impact,
        provider: "stripe",
        providerRef: "tmr_R",
        unpairAtProvider: true,
      });

      expect(await snapshot()).toEqual(
        withReaderRow(before, v.r, (row) => ({
          ...row,
          active: 0,
          disabled_at: expectedDisabledAt,
        })),
      );
    },
  );

  it.each([
    { state: "a provider that cannot unpair", list: seats, unpairedAt: null },
    { state: "an already unpaired reader", list: [unpairing], unpairedAt: UNPAIRED },
  ])("writes nothing for $state", async ({ list, unpairedAt }) => {
    const v = await seedVenue({ unpairedAt });
    await connectStripe(suite.db);
    const before = await snapshot();
    expect(await prepare(list, v.r)).toMatchObject({ unpairAtProvider: false });
    expect(await snapshot()).toEqual(before);
  });

  it("throws the first refusal and writes nothing", async () => {
    const v = await seedVenue({ unpairedAt: null });
    await v.payment("attempting", v.caja2.id);
    const before = await snapshot();
    await expect(prepare([unpairing], v.r)).rejects.toMatchObject({
      code: "reader.payment_in_progress",
      params: { readerId: v.r },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("plans no provider call and writes nothing for a disconnected provider once the notice is accepted", async () => {
    const v = await seedVenue({ unpairedAt: null });
    const impact = await read([unpairing], v.r);
    const before = await snapshot();
    expect(await prepare([unpairing], v.r, NOW, accepted)).toEqual({
      impact,
      provider: "stripe",
      providerRef: "tmr_R",
      unpairAtProvider: false,
    });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses reader.provider_disconnected without the acceptance, and writes nothing", async () => {
    const v = await seedVenue({ unpairedAt: null });
    const before = await snapshot();
    await expect(prepare([unpairing], v.r)).rejects.toMatchObject({
      code: "reader.provider_disconnected",
      params: { providerId: "stripe" },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("plans the unpair for a connected provider whether or not the notice was accepted", async () => {
    const v = await seedVenue({ unpairedAt: null });
    await connectStripe(suite.db);
    expect(await prepare([unpairing], v.r, NOW, accepted)).toMatchObject({
      unpairAtProvider: true,
    });
  });
});

/** Runs `body` on a transaction whose `select` calls are counted, answering the count. */
const selectsMadeBy = (body: (tx: Transaction) => Promise<unknown>) =>
  withTransaction(suite.db, async (tx) => {
    let selects = 0;
    const counted = new Proxy(tx, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target) as unknown;
        if (typeof value !== "function") return value;
        const bound = (value as (...args: unknown[]) => unknown).bind(target);
        if (prop !== "select") return bound;
        return (...args: unknown[]) => {
          selects += 1;
          return bound(...args);
        };
      },
    });
    await body(counted);
    return selects;
  });

describe("starting a card reader delete (step a, and the delete when no provider is called)", () => {
  it("deletes a reader no provider must unpair, returning the impact it read", async () => {
    const v = await seedVenue({ unpairedAt: null });
    const impact = await read([unpairing], v.r);
    const before = await snapshot();

    const started = await withTransaction(suite.db, (tx) =>
      startCardReaderDelete(tx, [unpairing], v.r, NOW, accepted),
    );

    expect(started).toEqual({
      plan: { impact, provider: "stripe", providerRef: "tmr_R", unpairAtProvider: false },
      deleted: impact,
    });
    expect(await snapshot()).toEqual(
      withoutReaderLinks(before, v.r, (row) => ({
        ...row,
        active: 0,
        deleted_at: NOW.toISOString(),
        disabled_at: NOW.toISOString(),
      })),
    );
  });

  it("only switches off a reader its provider will unpair, leaving the delete to the caller", async () => {
    const v = await seedVenue({ unpairedAt: null });
    await connectStripe(suite.db);
    const impact = await read([unpairing], v.r);
    const before = await snapshot();

    const started = await withTransaction(suite.db, (tx) =>
      startCardReaderDelete(tx, [unpairing], v.r, NOW, accepted),
    );

    expect(started).toEqual({
      plan: { impact, provider: "stripe", providerRef: "tmr_R", unpairAtProvider: true },
    });
    expect(await snapshot()).toEqual(
      withReaderRow(before, v.r, (row) => ({ ...row, active: 0, disabled_at: NOW.toISOString() })),
    );
  });

  it("refuses as the delete does, and writes nothing", async () => {
    const v = await seedVenue({ unpairedAt: null });
    const before = await snapshot();
    await expect(
      withTransaction(suite.db, (tx) => startCardReaderDelete(tx, [unpairing], v.r, NOW)),
    ).rejects.toMatchObject({ code: "reader.provider_disconnected" });
    expect(await snapshot()).toEqual(before);
  });

  it("reads no more than the impact read does when it deletes in the one call", async () => {
    const v = await seedVenue({ unpairedAt: null });
    const reading = await selectsMadeBy((tx) => readCardReaderDeleteImpact(tx, [unpairing], v.r));
    const deleting = await selectsMadeBy((tx) =>
      startCardReaderDelete(tx, [unpairing], v.r, NOW, accepted),
    );
    expect(reading).toBeGreaterThan(0);
    expect(deleting).toBe(reading);
    const [row] = await suite.db.select().from(cardReaders).where(eq(cardReaders.id, v.r));
    expect(row!.deletedAt).toBe(NOW.toISOString());
  });
});

describe("marking a card reader unpaired", () => {
  it("switches off and stamps an undeleted reader as Unpair does", async () => {
    const v = await seedVenue({ unpairedAt: null });
    const at = "2026-10-10T11:00:00.000Z";
    const before = await snapshot();
    await withTransaction(suite.db, (tx) => markCardReaderUnpaired(tx, v.r, at));
    expect(await snapshot()).toEqual(
      withReaderRow(before, v.r, (row) => ({
        ...row,
        active: 0,
        disabled_at: at,
        unpaired_at: at,
      })),
    );
  });

  it("changes nothing on a deleted reader", async () => {
    const v = await seedVenue({ unpairedAt: null });
    await remove(seats, v.r);
    const before = await snapshot();
    await withTransaction(suite.db, (tx) =>
      markCardReaderUnpaired(tx, v.r, "2026-10-10T11:00:00.000Z"),
    );
    expect(await snapshot()).toEqual(before);
  });
});
