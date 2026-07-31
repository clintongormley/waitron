import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import {
  decimal,
  tenantId as brandTenantId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { getPaymentByRef } from "../store.js";
import { freshNif, seedWorkingOrder } from "../../test/seed.js";
import { FakeAsyncProvider } from "./fake-async-provider.js";

const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

beforeEach(async () => {
  await pg.db.execute(sql`truncate payment_refunds, payments cascade`);
});

describe("FakeAsyncProvider", () => {
  it("initiate writes an initiated row and returns a url + external ref", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    const provider = new FakeAsyncProvider(pg.db);
    const res = await provider.initiate({
      tenantId: brandTenantId(s.tenantId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      paymentRef: "pay-1",
    });
    expect(res.ref).toBe("pay-1");
    expect(res.externalRef).toMatch(/^fake-hosted-/);
    expect(res.url).toContain(res.externalRef);
    const row = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: "pay-1" }),
    );
    expect(row?.state).toBe("initiated");
    expect(row?.externalRef).toBe(res.externalRef);
  });

  it("verifyAndParse decodes a settled event built by FakeAsyncProvider.event", () => {
    const provider = new FakeAsyncProvider(pg.db);
    const at = new Date("2026-07-24T12:00:00Z");
    const payload = FakeAsyncProvider.event({
      externalRef: "fake-hosted-9",
      outcome: "settled",
      amount: "12.10",
      settledAt: at,
    });
    const event = provider.verifyAndParse(payload, "ignored-signature");
    expect(event).toEqual({
      provider: "fake",
      externalRef: "fake-hosted-9",
      outcome: "settled",
      amount: decimal("12.10"),
      settledAt: at,
    });
  });

  it("verifyAndParse returns null for an event of another provider", () => {
    const provider = new FakeAsyncProvider(pg.db);
    const payload = JSON.stringify({
      provider: "other",
      externalRef: "x",
      outcome: "settled",
      amount: "1.00",
      settledAt: new Date().toISOString(),
    });
    expect(provider.verifyAndParse(payload, "sig")).toBeNull();
  });
});
