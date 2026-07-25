import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import type { TenantId, WorkingOrderId } from "@waitron/shared";
import {
  associatePaymentWithSale,
  classify,
  DEFAULT_SETTLEMENT_LAG_MS,
  existingReferences,
  getPaymentByRef,
  insertCapturedPayment,
  insertFailedPayment,
  listReconcilable,
  MANUAL_PROVIDER,
  markReconcileRemediated,
  PAYMENTS_MIGRATIONS,
  reconcilePayments,
  recordManualCardPayment,
  recordManualRefund,
  recordRefund,
  recordVoid,
  tillsForWorkingOrders,
} from "./index.js";
import type {
  AsyncPaymentProvider,
  InboundSettlement,
  InitiateParams,
  InitiateResult,
  ManualCardPaymentParams,
  ManualCardPaymentResult,
  OrphanRemediation,
  PaymentMismatch,
  PaymentProvider,
  PaymentReconciler,
  PaymentReconcileResult,
  PaymentResult,
  SettlementRecord,
  SettlementReportSource,
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

describe("the reconcile surface", () => {
  it("re-exports the sweep and its default lag from the package root", () => {
    expect(typeof reconcilePayments).toBe("function");
    // `classify` is a type-erased runtime check too — a value export, unlike the interfaces below,
    // so a dropped re-export would slip past every type-only check here and be caught only here.
    expect(typeof classify).toBe("function");
    expect(DEFAULT_SETTLEMENT_LAG_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("re-exports the store queries the sweep is built on", () => {
    expect(typeof listReconcilable).toBe("function");
    expect(typeof existingReferences).toBe("function");
    expect(typeof markReconcileRemediated).toBe("function");
    expect(typeof tillsForWorkingOrders).toBe("function");
  });

  it("types a PaymentReconciler an adapter can implement against the root barrel", () => {
    // A structural check, exactly like the AsyncPaymentProvider one above: this is what a vendor
    // package's own reconciler has to satisfy, so it must be reachable and complete from here.
    const reconciler: PaymentReconciler = {
      provider: "fake",
      reconcile: async (_tenantId, period): Promise<PaymentReconcileResult> => ({
        period,
        checked: 0,
        unsettled: [],
        lostSettlement: [],
        orphan: [],
        missingLocal: [],
        drift: [],
        incidentsRaised: 0,
        remediated: 0,
        remediationFailures: [],
      }),
    };
    expect(reconciler.provider).toBe("fake");
  });

  it("types an OrphanRemediation value from the root barrel", () => {
    // Type-only export declared in ./errors.ts and re-exported from ./index.ts: nothing else in the
    // repo imports it, so this is the only thing that would catch it being deleted from the root
    // barrel — a deleted re-export fails this package's own `pnpm typecheck`, and the annotation
    // below forces that check against the ROOT barrel, not the deep `./errors.js` path.
    const remediation: OrphanRemediation = "amountDrifted";
    expect(remediation).toBe("amountDrifted");
  });

  it("types a SettlementReportSource and a mismatch from the root barrel", () => {
    // Both arguments named, not elided: the tenant is what a real source has to filter its report
    // by, so the surface test has to prove the barrel still hands it one.
    const source: SettlementReportSource = {
      fetch: async (tenantId, window): Promise<SettlementRecord[]> => [
        {
          references: [tenantId, window.from.toISOString()],
          amount: decimal("1.00"),
          settledAt: new Date(),
        },
      ],
    };
    const mismatch: PaymentMismatch = {
      paymentRef: "p",
      references: ["a"],
      localState: "captured",
      localAmount: "1.00",
      settledAmount: "1.00",
      workingOrderId: "w",
    };
    expect(typeof source.fetch).toBe("function");
    expect(mismatch.paymentRef).toBe("p");
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
    expect(getTableConfig(payments).indexes.map((i) => i.config.name)).toContain(
      "payments_reconcile_idx",
    );
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
