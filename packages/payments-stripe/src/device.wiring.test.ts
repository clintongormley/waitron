import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
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
import { PAYMENTS_MIGRATIONS, associatePaymentWithSale } from "@waitron/payments";
import { FakeStripeDevice } from "./testing/fake-stripe-device.js";
import { StripeOnDeviceProvider } from "./device-provider.js";
import { freshNif, seedForSale, seedPaymentPolicy } from "@waitron/payments/test/seed.js";
import type { SeededForSale } from "@waitron/payments/test/seed.js";

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

describe("on-device offline accept -> recordSale -> associate -> forward decline (sale stays chained)", () => {
  it("chains the sale on an offline-accepted device tender, then a forward-decline raises an incident without un-chaining it", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());
    await seedPaymentPolicy(pg.db, s.tenantId, "accept_offline", "50.00");

    const client = new FakeStripeDevice();
    client.nextCollect("offline"); // policy accepts + consent + under cap → the device stores offline
    const provider = new StripeOnDeviceProvider({
      client,
      db: pg.db,
      tenantId: brandTenantId(s.tenantId),
    });
    const paid = await provider.collect({
      tenantId: brandTenantId(s.tenantId),
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("10.00"),
      allowOffline: true,
    });
    expect(paid.state).toBe("accepted_offline");
    expect(paid.offline).toBe(true);

    const saleId = await pg.db.transaction(async (tx) => {
      const recorded = await recordSale(tx, backend, buildInput(s, paid.settledAt as Date));
      await associatePaymentWithSale(tx, {
        tenantId: s.tenantId,
        provider: "stripe",
        paymentRef: paid.paymentRef,
        saleId: recorded.saleId,
      });
      return recorded.saleId;
    });

    client.queueResult({ settled: [], declined: [paid.paymentRef] });
    const result = await provider.forward(BASE);
    expect(result).toMatchObject({ forwarded: 0, declined: 1, incidentsRaised: 1 });

    const rows = await pg.db.execute<{ state: string; sale_id: string | null }>(
      sql`select state, sale_id from payments where tenant_id = ${s.tenantId}`,
    );
    expect(rows.rows[0].state).toBe("declined");
    expect(rows.rows[0].sale_id).toBe(saleId);
    const sale = await pg.db.execute<{ id: string }>(
      sql`select id from sales where id = ${saleId}`,
    );
    expect(sale.rows).toHaveLength(1); // NOT voided or removed

    const incidents = await pg.db.transaction((tx) => openIncidents(tx, brandTillId(s.tillId)));
    expect(incidents).toHaveLength(1);
    expect(incidents[0].code).toBe("payment.offline_forward_declined");
    expect(incidents[0].saleId).toBe(saleId);
  });
});
