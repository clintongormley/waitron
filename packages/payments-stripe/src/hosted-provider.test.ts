import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  decimal,
  tenantId as brandTenantId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, getPaymentByRef } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import type { Seeded } from "@waitron/payments/test/seed.js";
import { FakeStripeHosted } from "./testing/fake-stripe-hosted.js";
import { StripeHostedProvider } from "./hosted-provider.js";

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.execute(sql`truncate payment_refunds, payments cascade`);
});

async function seed(): Promise<Seeded> {
  return seedWorkingOrder(db, freshNif());
}

describe("StripeHostedProvider.initiate", () => {
  it("mints a session and writes an initiated row with external_ref = session id", async () => {
    const s = await seed();
    const provider = new StripeHostedProvider({ client: new FakeStripeHosted(), db });
    const paymentRef = randomUUID();

    const res = await provider.initiate({
      tenantId: brandTenantId(s.tenantId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      paymentRef,
    });

    expect(res.ref).toBe(paymentRef);
    expect(res.externalRef).toMatch(/^cs_/);
    expect(res.url).toContain(res.externalRef);

    const row = await db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef }),
    );
    expect(row?.state).toBe("initiated");
    expect(row?.externalRef).toBe(res.externalRef);
    expect(row?.settledAt).toBeNull();
    expect(row?.saleId).toBeNull();
  });
});

describe("StripeHostedProvider.verifyAndParse", () => {
  const provider = () => new StripeHostedProvider({ client: new FakeStripeHosted(), db });

  it("maps checkout.session.completed to a settled InboundSettlement", () => {
    const payload = FakeStripeHosted.event({
      sessionId: "cs_123",
      type: "checkout.session.completed",
      amountTotalMinor: 1210,
      createdAt: new Date("2026-03-01T13:05:00Z"),
    });
    const ev = provider().verifyAndParse(payload, "good");
    expect(ev).toEqual({
      provider: "stripe",
      externalRef: "cs_123",
      outcome: "settled",
      amount: "12.10",
      settledAt: new Date("2026-03-01T13:05:00Z"),
    });
  });

  it("maps checkout.session.expired to an expired InboundSettlement", () => {
    const payload = FakeStripeHosted.event({ sessionId: "cs_9", type: "checkout.session.expired" });
    const ev = provider().verifyAndParse(payload, "good");
    expect(ev?.outcome).toBe("expired");
    expect(ev?.externalRef).toBe("cs_9");
  });

  it("returns null for an event we do not act on", () => {
    const payload = FakeStripeHosted.event({ sessionId: "cs_9", type: "payment_intent.created" });
    expect(provider().verifyAndParse(payload, "good")).toBeNull();
  });

  it("throws on a bad signature (does not swallow it)", () => {
    const client = new FakeStripeHosted();
    client.failSignatureNext();
    const p = new StripeHostedProvider({ client, db });
    const payload = FakeStripeHosted.event({
      sessionId: "cs_9",
      type: "checkout.session.completed",
    });
    expect(() => p.verifyAndParse(payload, "bad")).toThrow(/signature/i);
  });

  it("throws on a settled event with no amount_total (never silently settles 0.00)", () => {
    const payload = FakeStripeHosted.event({
      sessionId: "cs_noamt",
      type: "checkout.session.completed",
      amountTotalMinor: null,
    });
    expect(() => provider().verifyAndParse(payload, "good")).toThrow(/amount_total/i);
  });
});
