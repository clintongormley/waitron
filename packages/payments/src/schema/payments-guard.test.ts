import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, captureError, triggerRaised } from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { installTriggers, triggerFaults } from "@waitron/store";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { PAYMENT_CHANGE_REFUSAL, PAYMENT_DELETE_REFUSAL } from "../trigger-refusals.js";
import { payments } from "./payments.js";
import { seedBillPayment, seedHeldReader, seedSale, seedWorkingOrder } from "../../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const AT = "2026-07-22T10:00:00.000Z";
let paymentId: string;

beforeEach(async () => {
  const seeded = await seedWorkingOrder(suite.db);
  const [row] = await suite.db
    .insert(payments)
    .values({
      workingOrderId: seeded.workingOrderId,
      source: "device",
      deviceId: seeded.deviceId,
      nodeId: seeded.nodeId,
      provider: "fake",
      paymentRef: "guard",
      amount: 1000,
      state: "attempting",
      createdAt: AT,
    })
    .returning({ id: payments.id });
  paymentId = row!.id;
});

describe("a payment's fixed columns", () => {
  it.each([
    ["id", "'different'"],
    ["working_order_id", "'different'"],
    ["source", "'dashboard'"],
    ["device_id", "null"],
    ["node_id", "null"],
    ["provider", "'other'"],
    ["payment_ref", "'different'"],
    ["created_at", "'2026-07-23T10:00:00.000Z'"],
  ])("refuses a change to %s", async (column, value) => {
    const error = await captureError(() =>
      suite.db.execute(
        sql`update payments set ${sql.identifier(column)} = ${sql.raw(value)} where id = ${paymentId}`,
      ),
    );
    expect(triggerRaised(error, PAYMENT_CHANGE_REFUSAL)).toBe(true);
  });

  it.each([
    "sale_id",
    "reader_id",
    "reconcile_remediated_at",
    "requested_amount",
    "bill_payment_id",
    "provider_checkout_started_at",
  ])("sets %s once", async (column) => {
    const seeded = await seedWorkingOrder(suite.db);
    const first =
      column === "sale_id"
        ? await seedSale(suite.db, seeded)
        : column === "bill_payment_id"
          ? await seedBillPayment(suite.db, seeded)
          : column === "requested_amount"
            ? 1000
            : column === "reader_id"
              ? await seedHeldReader(suite.db, seeded.deviceId)
              : AT;
    await suite.db.execute(
      sql`update payments set ${sql.identifier(column)} = ${first} where id = ${paymentId}`,
    );
    const saved = await suite.db.execute(
      sql`select ${sql.identifier(column)} as value from payments where id = ${paymentId}`,
    );
    expect(saved.rows[0]!.value).toBe(first);
    for (const value of ["different", null]) {
      const error = await captureError(() =>
        suite.db.execute(
          sql`update payments set ${sql.identifier(column)} = ${value} where id = ${paymentId}`,
        ),
      );
      expect(triggerRaised(error, PAYMENT_CHANGE_REFUSAL)).toBe(true);
    }
  });

  it("still captures a payment with a different confirmed amount and card facts", async () => {
    await suite.db
      .execute(sql`update payments set state = 'captured', amount = 1100, requested_amount = 1000,
      settled_at = ${AT}, external_ref = 'processor', card_scheme = 'visa', card_last4 = '1234',
      card_entry_mode = 'chip', card_auth_code = 'auth', updated_at = ${AT} where id = ${paymentId}`);
    const [row] = await suite.db.select().from(payments);
    expect(row).toMatchObject({
      state: "captured",
      amount: 1100,
      requestedAmount: 1000,
      settledAt: AT,
      externalRef: "processor",
      cardScheme: "visa",
      cardLast4: "1234",
      cardEntryMode: "chip",
      cardAuthCode: "auth",
      updatedAt: AT,
    });
  });
});

it.each([null, "11111111-1111-4111-8111-111111111111"])(
  "keeps the initiating person fixed from insertion: %s",
  async (requestedBy) => {
    await seedPerson(suite.db, {
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "Starter",
    });
    await seedPerson(suite.db, {
      id: "22222222-2222-4222-8222-222222222222",
      displayName: "Other person",
    });
    const seeded = await seedWorkingOrder(suite.db);
    const [row] = await suite.db
      .insert(payments)
      .values({
        workingOrderId: seeded.workingOrderId,
        source: "device",
        deviceId: seeded.deviceId,
        provider: "fake",
        paymentRef: "fixed-starter",
        amount: 1000,
        state: "attempting",
        requestedBy,
      })
      .returning({ id: payments.id });
    for (const replacement of requestedBy === null
      ? ["22222222-2222-4222-8222-222222222222"]
      : [null, "22222222-2222-4222-8222-222222222222"]) {
      const error = await captureError(() =>
        suite.db.execute(
          sql`update payments set requested_by = ${replacement} where id = ${row!.id}`,
        ),
      );
      expect(triggerRaised(error, PAYMENT_CHANGE_REFUSAL)).toBe(true);
    }
  },
);

it.each(["attempting", "captured"])("never deletes a payment in state %s", async (state) => {
  await suite.db.execute(
    sql`update payments set state = ${state}, settled_at = ${state === "captured" ? AT : null} where id = ${paymentId}`,
  );
  const error = await captureError(() =>
    suite.db.execute(sql`delete from payments where id = ${paymentId}`),
  );
  expect(triggerRaised(error, PAYMENT_DELETE_REFUSAL)).toBe(true);
  const saved = await suite.db.execute(sql`select id from payments where id = ${paymentId}`);
  expect(saved.rows).toEqual([{ id: paymentId }]);
});

it("the real migration definitions match SQLite before and after guard repair", () => {
  const [options] = migrationOptionsFor(
    manifestSets().filter((set) => set.name === "payments"),
    null,
  );
  const triggers = options!.expectedTriggers!;
  expect(triggerFaults(suite.db, triggers)).toEqual({ missing: [], altered: [] });
  suite.db.run(sql`drop trigger payments_guard_update`);
  expect(triggerFaults(suite.db, triggers)).toEqual({
    missing: ["payments_guard_update"],
    altered: [],
  });
  installTriggers(suite.db, triggers);
  expect(triggerFaults(suite.db, triggers)).toEqual({ missing: [], altered: [] });
});

const resolution = {
  resolution_outcome: "failed",
  resolution_cancelled_at_provider: 0,
  resolution_provider_status: "first",
  resolved_by: "11111111-1111-4111-8111-111111111111",
  resolved_at: AT,
};
const hold = { held_at: AT, hold_provider_amount: 1210 };
const outcome = {
  ...hold,
  hold_outcome: "kept",
  hold_note: "First decision",
  hold_decided_by: "11111111-1111-4111-8111-111111111111",
  hold_decided_at: AT,
};

it.each<[Record<string, string | number | null>, string, string | number]>([
  [resolution, "resolution_outcome", "captured"],
  [resolution, "resolution_cancelled_at_provider", 1],
  [resolution, "resolution_provider_status", "later"],
  [resolution, "resolved_by", "22222222-2222-4222-8222-222222222222"],
  [resolution, "resolved_at", "later"],
  [{ ...resolution, resolved_by: null }, "resolved_by", "11111111-1111-4111-8111-111111111111"],
  [{ ...resolution, resolution_provider_status: null }, "resolution_provider_status", "later"],
  [hold, "held_at", "later"],
  [hold, "hold_provider_amount", 1211],
  [outcome, "hold_outcome", "refunded_at_provider"],
  [outcome, "hold_note", "Later decision"],
  [{ ...outcome, hold_note: null }, "hold_note", "Later decision"],
  [outcome, "hold_decided_by", "22222222-2222-4222-8222-222222222222"],
  [outcome, "hold_decided_at", "later"],
])("writes the follow-up group once, keeping %s / %s", async (group, column, replacement) => {
  await seedPerson(suite.db, {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "First actor",
  });
  await seedPerson(suite.db, {
    id: "22222222-2222-4222-8222-222222222222",
    displayName: "Second actor",
  });
  const fields = sql.join(
    Object.entries(group).map(([key, value]) => sql`${sql.identifier(key)} = ${value}`),
    sql`, `,
  );
  await suite.db.execute(sql`update payments set ${fields} where id = ${paymentId}`);
  const saved = await suite.db.execute(sql`select * from payments where id = ${paymentId}`);
  expect(saved.rows[0]).toMatchObject(group);
  for (const value of group[column] === null ? [replacement] : [replacement, null]) {
    const error = await captureError(() =>
      suite.db.execute(
        sql`update payments set ${sql.identifier(column)} = ${value} where id = ${paymentId}`,
      ),
    );
    expect(triggerRaised(error, PAYMENT_CHANGE_REFUSAL)).toBe(true);
  }
});
