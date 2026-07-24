import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { getPaymentPolicy, resolveOfflineDecision } from "./policy.js";
import type { PaymentPolicyRow } from "./policy.js";
import { freshNif, seedPaymentPolicy, seedWorkingOrder } from "../test/seed.js";

const ACCEPT: PaymentPolicyRow = { offlineMode: "accept_offline", offlineAmountCap: "50.00" };
const CASH_ONLY: PaymentPolicyRow = { offlineMode: "cash_only", offlineAmountCap: "50.00" };

describe("resolveOfflineDecision (the pure gate)", () => {
  it("refuses when the staff did not opt in, whatever the policy", () => {
    expect(resolveOfflineDecision(ACCEPT, false, decimal("10.00"))).toBe("refuse");
  });
  it("refuses (fail-safe) when the tenant has no policy row", () => {
    expect(resolveOfflineDecision(undefined, true, decimal("10.00"))).toBe("refuse");
  });
  it("refuses when the policy is cash_only", () => {
    expect(resolveOfflineDecision(CASH_ONLY, true, decimal("10.00"))).toBe("refuse");
  });
  it("refuses when the amount exceeds the cap", () => {
    expect(resolveOfflineDecision(ACCEPT, true, decimal("50.01"))).toBe("refuse");
  });
  it("accepts at exactly the cap with opt-in under accept_offline", () => {
    expect(resolveOfflineDecision(ACCEPT, true, decimal("50.00"))).toBe("accept");
  });
  it("accepts below the cap", () => {
    expect(resolveOfflineDecision(ACCEPT, true, decimal("10.00"))).toBe("accept");
  });
});

describe("getPaymentPolicy", () => {
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
    await db.execute(sql`truncate payment_policy cascade`);
  });

  it("returns undefined for a tenant with no policy row", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    const row = await db.transaction((tx) => getPaymentPolicy(tx, s.tenantId));
    expect(row).toBeUndefined();
  });

  it("reads back a tenant's policy row", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    await seedPaymentPolicy(db, s.tenantId, "accept_offline", "75.00");
    const row = await db.transaction((tx) => getPaymentPolicy(tx, s.tenantId));
    expect(row).toEqual({ offlineMode: "accept_offline", offlineAmountCap: "75.00" });
  });
});
