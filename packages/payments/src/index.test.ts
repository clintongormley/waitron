import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import {
  associatePaymentWithSale,
  getPaymentByRef,
  insertCapturedPayment,
  insertFailedPayment,
  MANUAL_PROVIDER,
  PAYMENTS_MIGRATIONS,
  recordManualCardPayment,
  recordManualRefund,
  recordRefund,
  recordVoid,
} from "./index.js";
import type {
  ManualCardPaymentParams,
  ManualCardPaymentResult,
  PaymentProvider,
  PaymentResult,
} from "./index.js";
import { payments } from "./schema/payments.js";
import { paymentRefunds } from "./schema/payment-refunds.js";

/**
 * A coherence check on the package root, not a duplicate of schema-ownership.test.ts,
 * migrations.test.ts, store.test.ts or errors.reachability.test.ts — this proves `./index.js`
 * itself re-exports the right things, mirroring `packages/fiscal-verifactu/src/index.test.ts`'s
 * own reasoning: every other test in this package imports its subjects from a deep path
 * (`./store.js`, `./schema/payments.js`, …), so none of them would catch a re-export deleted from
 * the root.
 *
 * The two re-export barrels (`src/index.ts`, `src/schema/index.ts`) are excluded from coverage as
 * pure manifests — v8 reports phantom branches on re-export bindings, and their surface is asserted
 * structurally here and in schema-ownership.test.ts (see vitest.config.ts's note). `provider.ts`
 * and `errors.ts` stay IN coverage and reach 100% under the full suite.
 */
describe("package public surface (./index.js)", () => {
  it("re-exports PAYMENTS_MIGRATIONS and the store functions from the package root", () => {
    expect(PAYMENTS_MIGRATIONS.migrationsTable).toBe("__drizzle_migrations_payments");
    expect(typeof insertCapturedPayment).toBe("function");
    expect(typeof insertFailedPayment).toBe("function");
    expect(typeof recordVoid).toBe("function");
    expect(typeof recordRefund).toBe("function");
    expect(typeof associatePaymentWithSale).toBe("function");
    expect(typeof getPaymentByRef).toBe("function");
  });

  it("re-exports the manual-tender surface from the package root", () => {
    expect(MANUAL_PROVIDER).toBe("manual");
    expect(typeof recordManualCardPayment).toBe("function");
    expect(typeof recordManualRefund).toBe("function");

    const params: ManualCardPaymentParams = {
      tenantId: "t",
      workingOrderId: "w",
      amount: decimal("1.00"),
      settledAt: new Date("2026-07-23T09:00:00Z"),
    };
    const result: ManualCardPaymentResult = {
      provider: "manual",
      paymentRef: "manual-x",
      settledAt: params.settledAt,
    };
    expect(result.provider).toBe("manual");
    expect(params.tenantId).toBe("t");
  });

  it("re-exports the provider types (PaymentProvider, PaymentResult) from the package root", () => {
    // Both are type-only exports, so the meaningful check is that ./index.ts's re-export still
    // type-checks against a real value shaped by ./provider.ts — a deleted re-export would fail
    // this package's own `pnpm typecheck`, not this assertion, but the annotations below are
    // what force that check to be against the ROOT barrel rather than a deep path.
    const result: PaymentResult = {
      provider: "fake",
      paymentRef: "pay-1",
      state: "captured",
      amount: decimal("10.00"),
      settledAt: new Date("2026-07-22T10:00:00Z"),
    };
    const capabilities: PaymentProvider["capabilities"] = { partialRefund: false };
    expect(result.provider).toBe("fake");
    expect(capabilities.partialRefund).toBe(false);
  });
});

/**
 * drizzle invokes each table's `(t) => [...]` extraConfig callback LAZILY — a plain import never
 * runs it, which is why `payments.ts` lines ~63-81 and `payment-refunds.ts`'s constraint block
 * show as uncovered even though every other test in this package imports these tables. Calling
 * `getTableConfig` forces the callback to run, and the assertions below are the meaningful check
 * that the constraints these tables declare actually exist under the names the rest of the
 * schema (FKs from other packages, migrations, RLS policies) depends on — not a coverage stunt.
 */
describe("schema constraint declarations (forces the lazy extraConfig callbacks)", () => {
  it("declares the payments table's unique, foreign-key, check and index constraints", () => {
    const config = getTableConfig(payments);

    const uniqueNames = config.uniqueConstraints.map((u) => u.getName());
    expect(uniqueNames).toContain("payments_tenant_id_key");
    expect(uniqueNames).toContain("payments_provider_ref_key");

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toContain("payments_working_order_fk");
    expect(fkNames).toContain("payments_sale_fk");

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("payments_amount_ck");

    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("payments_working_order_idx");
    expect(indexNames).toContain("payments_sale_idx");
  });

  it("declares the payment_refunds table's foreign-key and check constraints", () => {
    const config = getTableConfig(paymentRefunds);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toContain("payment_refunds_payment_fk");

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("payment_refunds_amount_ck");
  });
});
