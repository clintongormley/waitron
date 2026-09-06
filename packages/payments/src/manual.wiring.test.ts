import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import {
  decimal,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { associatePaymentWithSale } from "./store.js";
import { MANUAL_PROVIDER, recordManualCardPayment } from "./manual.js";
import { freshNif, seedForSale } from "../test/seed.js";
import type { SeededForSale } from "../test/seed.js";

// The manual-mode capstone: unlike the integrated wiring (wiring.test.ts), there is no network step
// and no separate collect() before the transaction — recordManualCardPayment runs INSIDE the sale
// transaction, so the payment, the sale, and the association commit atomically. That is the whole
// point: manual mode has no §4 orphan window.

const pg = usePgliteDb({
  migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
  setup: (db) => FakeFiscalBackend.install(db),
});

const BASE = new Date("2026-03-01T13:05:00+01:00");

const steadyClock: TrustedClock = {
  now: () => ({
    instant: BASE,
    offsetMinutes: 60,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("steadyClock: anchor() is not used by recordSale");
  },
  currentAnchor: () => null,
};

/** Builds the RecordSaleInput for one 12.10 card sale, taking the tender's settledAt off `settledAt`
 * (always set for a manual tender, so the sale always chains). */
function buildInput(s: SeededForSale, settledAt: Date): RecordSaleInput {
  return {
    tenantId: brandTenantId(s.tenantId),
    tillId: brandTillId(s.tillId),
    nodeId: brandNodeId(s.nodeId),
    seriesId: brandSeriesId(s.seriesId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    locale: "es",
    invoiceLocales: ["es"],
    total: "12.10",
    lines: [
      {
        lineNo: 1,
        descriptions: { es: "Item" },
        quantity: "1",
        unitPrice: "10.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
    ],
    // Immediate settlement, tip on the tender (zero here): sum(amount) 12.10 = total 12.10 + tip 0.00.
    settlement: {
      kind: "immediate",
      tenders: [{ method: "card", amount: "12.10", tipAmount: "0.00", settledAt }],
    },
    clock: steadyClock,
  };
}

describe("manual card tender -> recordSale -> associate (atomic, no provider)", () => {
  it("records the sale, the manual payment, and the association in one transaction", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());

    const saleId = await pg.db.transaction(async (tx) => {
      const recorded = await recordSale(tx, backend, buildInput(s, BASE));
      const manual = await recordManualCardPayment(tx, {
        tenantId: s.tenantId,
        workingOrderId: s.workingOrderId,
        amount: decimal("12.10"),
        settledAt: BASE,
        externalRef: "OP-000123",
      });
      await associatePaymentWithSale(tx, {
        tenantId: s.tenantId,
        provider: MANUAL_PROVIDER,
        paymentRef: manual.paymentRef,
        saleId: recorded.saleId,
      });
      return recorded.saleId;
    });

    const rows = await pg.db.execute<{
      provider: string;
      state: string;
      sale_id: string | null;
      external_ref: string | null;
    }>(sql`
      select provider, state, sale_id, external_ref
      from payments where tenant_id = ${s.tenantId}
    `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      provider: "manual",
      state: "captured",
      sale_id: saleId,
      external_ref: "OP-000123",
    });
  });

  it("rolls the manual payment back with the sale — no orphan row", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());
    const boom = new Error("boom");

    await expect(
      pg.db.transaction(async (tx) => {
        await recordSale(tx, backend, buildInput(s, BASE));
        await recordManualCardPayment(tx, {
          tenantId: s.tenantId,
          workingOrderId: s.workingOrderId,
          amount: decimal("12.10"),
          settledAt: BASE,
          externalRef: "OP-ROLLBACK",
        });
        throw boom;
      }),
    ).rejects.toBe(boom);

    const rows = await pg.db.execute<{ count: string }>(
      sql`select count(*)::text as count from payments where tenant_id = ${s.tenantId}`,
    );
    expect(rows.rows[0].count).toBe("0");
  });
});
