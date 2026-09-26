import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { is } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import type { WorkingOrderId } from "@waitron/shared";
import {
  associatePaymentWithSale,
  classify,
  countProviderCancelledResolutions,
  DEFAULT_SETTLEMENT_LAG_MS,
  existingReferences,
  getPaymentByRef,
  insertCapturedPayment,
  insertFailedPayment,
  listAttempting,
  listReconcilable,
  MANUAL_PROVIDER,
  markReconcileRemediated,
  PAYMENTS_MIGRATIONS,
  reconcilePayments,
  recordManualCardPayment,
  recordManualRefund,
  recordRefund,
  recordResolution,
  recordVoid,
  stampAttemptingRef,
  tillsForWorkingOrders,
} from "./index.js";
import type {
  AbandonedAttemptOutcome,
  AsyncPaymentProvider,
  AttemptingPayment,
  InboundSettlement,
  InitiateParams,
  InitiateResult,
  ManualCardPaymentParams,
  ManualCardPaymentResult,
  NewPaymentResolution,
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
 * The other suites mostly import their subjects from a deep path, so this one is what catches a
 * re-export deleted from the root. A type-only re-export is checked by `pnpm typecheck`: the
 * annotations below are what point that check at the ROOT barrel.
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
    expect(typeof listAttempting).toBe("function");
    expect(typeof stampAttemptingRef).toBe("function");
    const attempting: AttemptingPayment = {
      paymentRef: "ref-a",
      workingOrderId: "w",
      amount: "10.00",
      externalRef: null,
      createdAt: "2026-07-22T10:00:00Z",
    };
    expect(attempting.externalRef).toBeNull();
  });

  it("re-exports the manual-tender surface from the package root", () => {
    expect(MANUAL_PROVIDER).toBe("manual");
    expect(typeof recordManualCardPayment).toBe("function");
    expect(typeof recordManualRefund).toBe("function");

    const params: ManualCardPaymentParams = {
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
    expect(params.workingOrderId).toBe("w");
  });

  it("re-exports the provider types (PaymentProvider, PaymentResult) from the package root", () => {
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

describe("the stuck-payment resolution surface", () => {
  it("re-exports the resolution audit helpers from the package root", () => {
    expect(typeof recordResolution).toBe("function");
    expect(typeof countProviderCancelledResolutions).toBe("function");
    const resolution: NewPaymentResolution = {
      paymentId: "p",
      workingOrderId: "w",
      personId: "m",
      outcome: "failed",
      cancelledAtProvider: true,
      providerStatus: null,
      resolvedAt: new Date("2026-09-26T12:00:00Z"),
    };
    expect(resolution.outcome).toBe("failed");
    const outcome: AbandonedAttemptOutcome = { outcome: "unknown", reason: "ambiguous" };
    expect(outcome.outcome).toBe("unknown");
  });
});

describe("the reconcile surface", () => {
  it("re-exports the sweep and its default lag from the package root", () => {
    expect(typeof reconcilePayments).toBe("function");
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
    const reconciler: PaymentReconciler = {
      provider: "fake",
      reconcile: async (period): Promise<PaymentReconcileResult> => ({
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
    const remediation: OrphanRemediation = "amountDrifted";
    expect(remediation).toBe("amountDrifted");
  });

  it("types a SettlementReportSource and a mismatch from the root barrel", () => {
    const source: SettlementReportSource = {
      fetch: async (window): Promise<SettlementRecord[]> => [
        {
          references: [window.from.toISOString()],
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
 * drizzle invokes each table's extraConfig callback LAZILY, so a plain import never runs it;
 * `getTableConfig` forces it.
 */
describe("schema constraint declarations (forces the lazy extraConfig callbacks)", () => {
  it("declares the payments table's unique, foreign-key, check and index constraints", () => {
    const config = getTableConfig(payments);

    const uniqueNames = config.uniqueConstraints.map((u) => u.getName());
    expect(uniqueNames).toEqual(["payments_provider_ref_key"]);

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

  it("declares the payment_policy table's one-row and value check constraints", () => {
    const config = getTableConfig(paymentPolicy);

    expect(config.foreignKeys).toEqual([]);

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("payment_policy_singleton_ck");
    expect(checkNames).toContain("payment_policy_offline_mode_ck");
    expect(checkNames).toContain("payment_policy_cap_ck");
  });

  it("forces the extraConfig callback of every owned schema table (new tables can't drop coverage)", () => {
    // The barrel also exports non-table values, hence `unknown[]` before narrowing to tables.
    const tables = (Object.values(schema) as unknown[]).filter((v): v is SQLiteTable =>
      is(v, SQLiteTable),
    );
    // Positive control: without it the loop below would pass vacuously against an empty set.
    expect(tables.length).toBeGreaterThanOrEqual(3);
    for (const table of tables) {
      expect(() => getTableConfig(table)).not.toThrow();
    }
  });
});
