import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import type { TenantId, WorkingOrderId } from "@waitron/shared";
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
  AsyncPaymentProvider,
  InboundSettlement,
  InitiateParams,
  InitiateResult,
  ManualCardPaymentParams,
  ManualCardPaymentResult,
  PaymentProvider,
  PaymentResult,
} from "./index.js";
import { payments } from "./schema/payments.js";
import { paymentRefunds } from "./schema/payment-refunds.js";
import { paymentPolicy } from "./schema/payment-policy.js";
import * as schema from "./schema/index.js";

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

  it("re-exports the async (Mode 3) provider types from the package root", () => {
    // Type-only exports: the meaningful check is that ./index.ts's re-export type-checks against a
    // real value shaped by ./provider.ts — a deleted re-export fails this package's `pnpm typecheck`,
    // and the annotations force that check against the ROOT barrel, not a deep path.
    const settlement: InboundSettlement = {
      provider: "fake",
      externalRef: "hosted-1",
      outcome: "settled",
      amount: decimal("12.10"),
      settledAt: new Date("2026-07-24T10:00:00Z"),
    };
    const result: InitiateResult = {
      ref: "pay-1",
      externalRef: "hosted-1",
      url: "https://pay/hosted-1",
    };
    const params: InitiateParams = {
      tenantId: "t" as TenantId,
      workingOrderId: "w" as WorkingOrderId,
      amount: decimal("12.10"),
      paymentRef: "pay-1",
    };
    const asyncProvider: AsyncPaymentProvider["provider"] = "fake";
    expect(settlement.outcome).toBe("settled");
    expect(result.externalRef).toBe("hosted-1");
    expect(params.paymentRef).toBe("pay-1");
    expect(asyncProvider).toBe("fake");
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

  it("declares the payment_policy table's foreign-key and check constraints", () => {
    const config = getTableConfig(paymentPolicy);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toContain("payment_policy_tenant_fk");

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("payment_policy_offline_mode_ck");
    expect(checkNames).toContain("payment_policy_cap_ck");
  });

  // Future-proofing net for the lazy-callback problem above. The per-table blocks assert specific
  // constraint names, but each also has to REMEMBER to call `getTableConfig` or that table's
  // extraConfig lines go uncovered — which is exactly how `payment_policy` sank the package to
  // 96.45% (< the 98% CI threshold) until its block was added. This iterates EVERY table the schema
  // barrel exports and forces its callback, so a newly-added table is covered here automatically:
  // adding a table can no longer silently drop coverage even before someone writes its named block.
  // (Coverage isn't run by the pre-push hook — only in CI — so preventing the regression beats
  // catching it.)
  it("forces the extraConfig callback of every owned schema table (new tables can't drop coverage)", () => {
    // The barrel also exports pgEnums, so cast to unknown[] first to let `is(v, PgTable)` narrow to
    // the tables only (mirrors schema-ownership.test.ts's filter, but narrowing for getTableConfig).
    const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));
    // Positive control: without it the loop below would pass vacuously against an empty set.
    expect(tables.length).toBeGreaterThanOrEqual(3); // payments, payment_refunds, payment_policy
    for (const table of tables) {
      expect(() => getTableConfig(table)).not.toThrow();
    }
  });
});
