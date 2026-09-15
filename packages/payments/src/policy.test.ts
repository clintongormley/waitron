import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { decimal } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { getPaymentPolicy, resolveOfflineDecision } from "./policy.js";
import type { PaymentPolicyRow } from "./policy.js";
import { seedPaymentPolicy } from "../test/seed.js";

const ACCEPT: PaymentPolicyRow = { offlineMode: "accept_offline", offlineAmountCap: "50.00" };
const CASH_ONLY: PaymentPolicyRow = { offlineMode: "cash_only", offlineAmountCap: "50.00" };

describe("resolveOfflineDecision (the pure gate)", () => {
  it("refuses when the staff did not opt in, whatever the policy", () => {
    expect(resolveOfflineDecision(ACCEPT, false, decimal("10.00"))).toBe("refuse");
  });
  it("refuses (fail-safe) when there is no policy row", () => {
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
  const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });
  beforeEach(async () => {
    await pg.db.execute(sql`truncate payment_policy cascade`);
  });

  it("returns undefined when no policy row exists", async () => {
    const row = await pg.db.transaction((tx) => getPaymentPolicy(tx));
    expect(row).toBeUndefined();
  });

  it("reads back the venue's policy row", async () => {
    await seedPaymentPolicy(pg.db, "accept_offline", "75.00");
    const row = await pg.db.transaction((tx) => getPaymentPolicy(tx));
    expect(row).toEqual({ offlineMode: "accept_offline", offlineAmountCap: "75.00" });
  });
});
