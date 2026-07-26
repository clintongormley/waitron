import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  decimal,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { openIncidents, recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { associatePaymentWithSale } from "./store.js";
import { FakePaymentProvider } from "./testing/fake-provider.js";
import { freshNif, seedForSale, seedPaymentPolicy } from "../test/seed.js";
import type { SeededForSale } from "../test/seed.js";

let db: Database;
beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
  await FakeFiscalBackend.install(db);
}, 60_000);
afterAll(async () => {
  await db.close();
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

function buildInput(s: SeededForSale, settledAt: Date): RecordSaleInput {
  return {
    tenantId: brandTenantId(s.tenantId),
    tillId: brandTillId(s.tillId),
    seriesId: brandSeriesId(s.seriesId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    locale: "es",
    invoiceLocales: ["es"],
    total: "10.00",
    tipAmount: "0.00",
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
    tenders: [{ method: "card", amount: "10.00", settledAt }],
    fiscalBackend: "fake",
    clock: steadyClock,
  };
}

describe("offline accept -> recordSale -> associate -> forward decline (sale stays chained)", () => {
  it("chains the sale on an offline-accepted tender, then a forward-decline raises an incident without un-chaining it", async () => {
    const backend = new FakeFiscalBackend(db);
    const s = await seedForSale(db, backend, freshNif());
    await seedPaymentPolicy(db, s.tenantId, "accept_offline", "50.00");

    // 1. Offline accept BEFORE the sale transaction (there is an acceptance step, unlike manual mode).
    const provider = new FakePaymentProvider(db, s.tenantId);
    provider.offlineNextCollect();
    const paid = await provider.collect({
      tenantId: brandTenantId(s.tenantId),
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("10.00"),
      allowOffline: true,
    });
    expect(paid.state).toBe("accepted_offline");
    expect(paid.offline).toBe(true);
    expect(paid.settledAt).not.toBeNull();

    // 2. The settled tender chains the sale; associate the payment in the same transaction.
    const saleId = await db.transaction(async (tx) => {
      const recorded = await recordSale(tx, backend, buildInput(s, paid.settledAt as Date));
      await associatePaymentWithSale(tx, {
        tenantId: s.tenantId,
        provider: "fake",
        paymentRef: paid.paymentRef,
        saleId: recorded.saleId,
      });
      return recorded.saleId;
    });

    // 3. Later, the network refuses the forwarded payment.
    provider.declineForwardFor(paid.paymentRef);
    const result = await provider.forward(BASE);
    expect(result).toMatchObject({ forwarded: 0, declined: 1, incidentsRaised: 1 });

    // The payment is declined; the SALE is untouched (immutable — same row, still present).
    const rows = await db.execute<{ state: string; sale_id: string | null }>(sql`
      select state, sale_id from payments where tenant_id = ${s.tenantId}`);
    expect(rows.rows[0].state).toBe("declined");
    expect(rows.rows[0].sale_id).toBe(saleId);
    const sale = await db.execute<{ id: string }>(sql`select id from sales where id = ${saleId}`);
    expect(sale.rows).toHaveLength(1); // the sale was NOT voided or removed

    // One staff-facing incident exists for the till.
    const incidents = await db.transaction((tx) => openIncidents(tx, brandTillId(s.tillId)));
    expect(incidents).toHaveLength(1);
    expect(incidents[0].code).toBe("payment.offline_forward_declined");
    expect(incidents[0].saleId).toBe(saleId);
  });
});
