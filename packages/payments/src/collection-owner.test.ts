// The writers of `payments`, from
// `git grep -n "insert(payments)" -- 'packages/**/*.ts' 'apps/**/*.ts'` with test files left out:
//
//   packages/payments/src/store.ts:83:  await tx.insert(payments).values({
//
// Every path reaches that one insert through a store function below, the manual tender, or a
// provider's `collect`/`initiate`. The Stripe and SumUp providers are covered in their own packages.
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { recordManualCardPayment } from "./manual.js";
import { SimulatorPaymentProvider } from "./simulator.js";
import {
  insertAttempting,
  insertCapturedPayment,
  insertFailedPayment,
  insertInitiated,
} from "./store.js";
import { FakePaymentProvider } from "./testing/fake-provider.js";
import { FakeAsyncProvider } from "./testing/fake-async-provider.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

beforeEach(async () => {
  await suite.db.execute(sql`delete from payment_refunds`);
  await suite.db.execute(sql`delete from payments`);
});

async function setup() {
  const seeded = await seedWorkingOrder(suite.db, freshNif());
  const common = {
    origin: deviceOrigin(seeded.deviceId),
    workingOrderId: seeded.workingOrderId,
    nodeId: seeded.nodeId,
    provider: "fake",
    amount: decimal("10.00"),
  };
  return { seeded, common };
}

async function storedNode(paymentRef: string): Promise<string | null | undefined> {
  const rows = await suite.db.execute<{ node_id: string | null }>(
    sql`select node_id from payments where payment_ref = ${paymentRef}`,
  );
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0]?.node_id;
}

describe("a payment carries the node id of the box that started it", () => {
  it("insertCapturedPayment", async () => {
    const { seeded, common } = await setup();
    await withTransaction(suite.db, (tx) =>
      insertCapturedPayment(tx, { ...common, paymentRef: "own-captured", settledAt: new Date() }),
    );
    expect(await storedNode("own-captured")).toBe(seeded.nodeId);
  });

  it("insertFailedPayment", async () => {
    const { seeded, common } = await setup();
    await withTransaction(suite.db, (tx) =>
      insertFailedPayment(tx, { ...common, paymentRef: "own-failed" }),
    );
    expect(await storedNode("own-failed")).toBe(seeded.nodeId);
  });

  it("insertAttempting", async () => {
    const { seeded, common } = await setup();
    await withTransaction(suite.db, (tx) =>
      insertAttempting(tx, { ...common, paymentRef: "own-attempting" }),
    );
    expect(await storedNode("own-attempting")).toBe(seeded.nodeId);
  });

  it("insertInitiated", async () => {
    const { seeded, common } = await setup();
    await withTransaction(suite.db, (tx) =>
      insertInitiated(tx, { ...common, paymentRef: "own-initiated", externalRef: "ext-own" }),
    );
    expect(await storedNode("own-initiated")).toBe(seeded.nodeId);
  });

  it("recordManualCardPayment", async () => {
    const { seeded, common } = await setup();
    const result = await withTransaction(suite.db, (tx) =>
      recordManualCardPayment(tx, {
        origin: common.origin,
        workingOrderId: common.workingOrderId,
        nodeId: common.nodeId,
        amount: common.amount,
        settledAt: new Date(),
      }),
    );
    expect(await storedNode(result.paymentRef)).toBe(seeded.nodeId);
  });

  it("SimulatorPaymentProvider.collect", async () => {
    const { seeded, common } = await setup();
    const result = await new SimulatorPaymentProvider(suite.db).collect({
      origin: common.origin,
      workingOrderId: brandWorkingOrderId(seeded.workingOrderId),
      nodeId: common.nodeId,
      amount: common.amount,
    });
    expect(await storedNode(result.paymentRef)).toBe(seeded.nodeId);
  });

  it("FakePaymentProvider.collect", async () => {
    const { seeded, common } = await setup();
    const result = await new FakePaymentProvider(suite.db).collect({
      origin: common.origin,
      workingOrderId: brandWorkingOrderId(seeded.workingOrderId),
      nodeId: common.nodeId,
      amount: common.amount,
    });
    expect(await storedNode(result.paymentRef)).toBe(seeded.nodeId);
  });

  it("FakeAsyncProvider.initiate", async () => {
    const { seeded, common } = await setup();
    const result = await new FakeAsyncProvider(suite.db).initiate({
      origin: common.origin,
      workingOrderId: brandWorkingOrderId(seeded.workingOrderId),
      nodeId: common.nodeId,
      amount: common.amount,
      paymentRef: "own-hosted",
    });
    expect(await storedNode(result.ref)).toBe(seeded.nodeId);
  });
});
