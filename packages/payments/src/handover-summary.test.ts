import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  billPaymentRefunds,
  billPaymentRefundState,
  CORE_MIGRATIONS,
  tenderRefunds,
  tenders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { archiveTo, openBackupQuery } from "@waitron/store";
import { PAYMENTS_HANDOVER, summariseOpenPayments, type OpenPayments } from "./handover-summary.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { paymentState, payments } from "./schema/payments.js";
import { seedBillPayment, seedSale, seedWorkingOrder, type Seeded } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });
let directory: string | undefined;
let seeded: Seeded;
let saleId: string;

beforeEach(async () => {
  seeded = await seedWorkingOrder(suite.db);
  saleId = await seedSale(suite.db, seeded);
});

afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function copy(): Promise<string> {
  directory ??= await mkdtemp(join(tmpdir(), "waitron-payments-handover-"));
  const target = join(directory, `copy-${Date.now()}-${Math.random()}.db`);
  await archiveTo(suite.db, target);
  return target;
}

async function summarise(path?: string): Promise<OpenPayments> {
  const opened = await openBackupQuery(path ?? (await copy()));
  try {
    return await summariseOpenPayments(opened.query);
  } finally {
    await opened.close();
  }
}

const ALL_STATES = paymentState.enumValues;
const OPEN_STATES = ["attempting", "initiated"] as const;

async function payment(state: (typeof ALL_STATES)[number], provider: string, ref: string) {
  const [row] = await suite.db
    .insert(payments)
    .values({
      workingOrderId: seeded.workingOrderId,
      source: "device",
      deviceId: seeded.deviceId,
      provider,
      paymentRef: ref,
      amount: 1000,
      state,
    })
    .returning({ id: payments.id });
  return row!.id;
}

const STAMPED = "2026-07-01T12:30:00.000Z";

async function refund(
  state: "pending" | "completed" | "failed",
  method: "cash" | "card",
  card: { provider: string; ref: string } | "manual" | null,
) {
  const [tender] = await suite.db
    .insert(tenders)
    .values({ saleId, method, amount: 1000, settledAt: STAMPED })
    .returning({ id: tenders.id });
  const [row] = await suite.db
    .insert(tenderRefunds)
    .values({
      saleId,
      tenderId: tender!.id,
      submissionId: `submission-${Math.random()}`,
      fingerprint: "fingerprint",
      appliedAmount: 500,
      reason: "Wrong dish",
      authorizedBy: "11111111-1111-1111-1111-111111111111",
      requestedBy: "11111111-1111-1111-1111-111111111111",
      source: "device",
      deviceId: seeded.deviceId,
      nodeId: seeded.nodeId,
      method,
      manual: card === "manual",
      provider: typeof card === "object" && card !== null ? card.provider : null,
      providerPaymentRef: typeof card === "object" && card !== null ? card.ref : null,
      state,
      completedAt: state === "completed" ? STAMPED : null,
      failedAt: state === "failed" ? STAMPED : null,
    })
    .returning({ id: tenderRefunds.id });
  return row!.id;
}

/** A card bill payment and the provider row that charged it; `externalRef` is the processor's own. */
async function chargedBillPayment(provider: string, ref: string, externalRef: string | null) {
  const billPaymentId = await seedBillPayment(suite.db, seeded);
  await suite.db.insert(payments).values({
    workingOrderId: seeded.workingOrderId,
    source: "device",
    deviceId: seeded.deviceId,
    provider,
    paymentRef: ref,
    externalRef,
    amount: 1000,
    state: "captured",
    billPaymentId,
  });
  return billPaymentId;
}

async function billRefund(
  billPaymentId: string,
  state: (typeof billPaymentRefundState.enumValues)[number],
  sentAt: string | null,
) {
  const [row] = await suite.db
    .insert(billPaymentRefunds)
    .values({
      billPaymentId,
      submissionId: `submission-${Math.random()}`,
      fingerprint: "fingerprint",
      appliedAmount: 300,
      reason: "Wrong dish",
      authorizedBy: "11111111-1111-1111-1111-111111111111",
      requestedBy: "11111111-1111-1111-1111-111111111111",
      source: "device",
      deviceId: seeded.deviceId,
      state,
      sentAt,
      sendCount: sentAt === null ? 0 : 1,
      completedAt: state === "completed" ? STAMPED : null,
      failedAt: state === "failed" ? STAMPED : null,
    })
    .returning({ id: billPaymentRefunds.id });
  return row!.id;
}

describe("summariseOpenPayments", () => {
  it("lists every payment in attempting and initiated with its provider reference", async () => {
    const expected = [];
    for (const [i, state] of OPEN_STATES.entries()) {
      const provider = i === 1 ? "stripe" : "sumup";
      const ref = `ref-${state}`;
      expected.push({
        paymentId: await payment(state, provider, ref),
        provider,
        reference: ref,
        state,
      });
    }
    expected.push({
      paymentId: await payment("attempting", "sumup", "ref-second"),
      provider: "sumup",
      reference: "ref-second",
      state: "attempting" as const,
    });
    expected.sort((x, y) => (x.paymentId < y.paymentId ? -1 : 1));

    const summary = await summarise();

    expect(summary.payments).toEqual(expected);
    expect(summary.refunds).toEqual([]);
    expect(summary.billRefunds).toEqual([]);
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });

  it("lists no payment in another state", async () => {
    const others = ALL_STATES.filter(
      (state) => !(OPEN_STATES as readonly string[]).includes(state),
    );
    expect(others.length).toBe(ALL_STATES.length - OPEN_STATES.length);
    for (const state of others) await payment(state, "sumup", `ref-${state}`);
    const open = await payment("initiated", "stripe", "ref-open");

    const summary = await summarise();

    expect(summary.payments.map((row) => row.paymentId)).toEqual([open]);
  });

  it("lists every pending card refund and no completed or failed one", async () => {
    const first = await refund("pending", "card", { provider: "sumup", ref: "pay-1" });
    const second = await refund("pending", "card", { provider: "stripe", ref: "pay-2" });
    const manual = await refund("pending", "card", "manual");
    await refund("pending", "cash", null);
    await refund("completed", "card", { provider: "sumup", ref: "pay-3" });
    await refund("failed", "card", { provider: "sumup", ref: "pay-4" });
    await refund("completed", "cash", null);
    await refund("failed", "card", "manual");

    const summary = await summarise();

    expect(summary.refunds).toEqual(
      [
        { refundId: first, provider: "sumup", providerPaymentRef: "pay-1" },
        { refundId: second, provider: "stripe", providerPaymentRef: "pay-2" },
        { refundId: manual, provider: null, providerPaymentRef: null },
      ].sort((x, y) => (x.refundId < y.refundId ? -1 : 1)),
    );
    expect(summary.payments).toEqual([]);
  });

  it("lists every pending bill refund with the references its provider is asked by", async () => {
    const sumup = await chargedBillPayment("sumup", "sumup-ref", "txn-1");
    const simulator = await chargedBillPayment("simulator", "sim-ref", null);
    const sent = await billRefund(sumup, "pending", STAMPED);
    const unsent = await billRefund(sumup, "pending", null);
    const own = await billRefund(simulator, "pending", STAMPED);

    const summary = await summarise();

    expect(summary.billRefunds).toEqual(
      [
        {
          refundId: sent,
          billPaymentId: sumup,
          provider: "sumup",
          paymentRef: "sumup-ref",
          processorRef: "txn-1",
          sentAt: STAMPED,
        },
        {
          refundId: unsent,
          billPaymentId: sumup,
          provider: "sumup",
          paymentRef: "sumup-ref",
          processorRef: "txn-1",
          sentAt: null,
        },
        {
          refundId: own,
          billPaymentId: simulator,
          provider: "simulator",
          paymentRef: "sim-ref",
          processorRef: "sim-ref",
          sentAt: STAMPED,
        },
      ].sort((x, y) => (x.refundId < y.refundId ? -1 : 1)),
    );
    expect(summary.payments).toEqual([]);
    expect(summary.refunds).toEqual([]);
  });

  it("lists a pending bill refund whose bill payment has no provider row, with no provider references", async () => {
    const uncharged = await seedBillPayment(suite.db, seeded);
    const refundId = await billRefund(uncharged, "pending", null);

    const summary = await summarise();

    expect(summary.billRefunds).toEqual([
      {
        refundId,
        billPaymentId: uncharged,
        provider: null,
        paymentRef: null,
        processorRef: null,
        sentAt: null,
      },
    ]);
  });

  it("lists no bill refund in another state", async () => {
    const billPaymentId = await chargedBillPayment("sumup", "sumup-ref", "txn-1");
    const others = billPaymentRefundState.enumValues.filter((state) => state !== "pending");
    expect(others.length).toBe(billPaymentRefundState.enumValues.length - 1);
    for (const state of others) await billRefund(billPaymentId, state, STAMPED);
    const open = await billRefund(billPaymentId, "pending", STAMPED);

    const summary = await summarise();

    expect(summary.billRefunds.map((row) => row.refundId)).toEqual([open]);
  });

  it("writes nothing", async () => {
    await payment("attempting", "sumup", "ref-quiet");
    await refund("pending", "card", { provider: "sumup", ref: "pay-quiet" });
    await billRefund(await chargedBillPayment("sumup", "bill-quiet", null), "pending", null);
    const path = await copy();
    const digest = () =>
      [path, `${path}-wal`, `${path}-shm`].map((file) =>
        existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null,
      );
    const before = digest();
    const summary = await summarise(path);
    expect(summary.payments).toHaveLength(1);
    expect(summary.refunds).toHaveLength(1);
    expect(summary.billRefunds).toHaveLength(1);
    expect(digest()).toEqual(before);
    expect(before[0]).not.toBeNull();
  });

  it("is the module's handover summary", () => {
    expect(PAYMENTS_HANDOVER.summarise).toBe(summariseOpenPayments);
  });
});
