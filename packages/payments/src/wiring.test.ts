import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  decimal,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { associatePaymentWithSale, getPaymentByRef } from "./store.js";
import { FakePaymentProvider } from "./testing/fake-provider.js";
import { freshNif, seedForSale } from "../test/seed.js";
import type { SeededForSale } from "../test/seed.js";

// Core's sale tables and this package's payment tables are both written here. `setup` installs the
// fake fiscal backend's own tables, which `registerNode`/`recordSale` need.
const pg = useVenueDb({
  migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
  setup: (db) => FakeFiscalBackend.install(db),
});

const BASE = new Date("2026-03-01T13:05:00+01:00");

/** `recordSale` never calls `anchor`/`currentAnchor`, so both are stubbed. */
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

/**
 * Takes the tender's `amount`/`settledAt` straight off the provider's `collect` result, so a
 * captured result yields a settled tender and a failed result an unsettled one.
 */
function buildInput(
  s: SeededForSale,
  tender: { amount: string; settledAt: Date | null },
): RecordSaleInput {
  return {
    tillId: brandTillId(s.tillId),
    nodeId: brandNodeId(s.nodeId),
    seriesId: brandSeriesId(s.seriesId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    locale: "es",
    invoiceLocales: ["es"],
    // The tip is zero, so the one tender's amount equals total + tip: the coverage identity
    // `settleSale` checks.
    total: "12.10",
    lines: [
      {
        lineNo: 1,
        name: "Item",
        descriptions: { es: "Item" },
        quantity: "1",
        unitPrice: "10.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
    ],
    settlement: {
      kind: "immediate",
      tenders: [
        { method: "card", amount: tender.amount, tipAmount: "0.00", settledAt: tender.settledAt },
      ],
    },
    clock: steadyClock,
  };
}

describe("collect -> recordSale -> associate (the payment seam, end to end)", () => {
  it("settles a tender, chains the sale, and associates the payment atomically", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());
    const provider = new FakePaymentProvider(pg.db);

    const paid = await provider.collect({
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
    });
    expect(paid.state).toBe("captured");
    expect(paid.settledAt).not.toBeNull();

    // The sale and the associate-back happen in ONE transaction, so the linkage is atomic with the
    // sale it points at.
    const saleId = await pg.db.transaction(async (tx) => {
      const recorded = await recordSale(tx, backend, buildInput(s, paid));
      await associatePaymentWithSale(tx, {
        provider: "fake",
        paymentRef: paid.paymentRef,
        saleId: recorded.saleId,
      });
      return recorded.saleId;
    });

    const row = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, { provider: "fake", paymentRef: paid.paymentRef }),
    );
    expect(row?.saleId).toBe(saleId);
    expect(row?.state).toBe("captured");
  });

  it("refuses the sale when the payment failed and leaves the tender unsettled", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());
    const provider = new FakePaymentProvider(pg.db);
    provider.failNextCollect();

    const paid = await provider.collect({
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
    });
    expect(paid.state).toBe("failed");
    expect(paid.settledAt).toBeNull();

    await expect(
      pg.db.transaction((tx) => recordSale(tx, backend, buildInput(s, paid))),
    ).rejects.toMatchObject({ code: "sale.tender_unsettled" });
  });
});
