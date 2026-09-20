import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  decimal,
  seriesId as brandSeriesId,
  nodeId as brandNodeId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import {
  PAYMENTS_MIGRATIONS,
  associatePaymentWithSale,
  getPaymentByRef,
  hasPaymentWithExternalRef,
  settleInitiated,
} from "@waitron/payments";
import { freshNif, seedForSale } from "@waitron/payments/test/seed.js";
import type { SeededForSale } from "@waitron/payments/test/seed.js";
import { FakeStripeHosted } from "./testing/fake-stripe-hosted.js";
import { StripeHostedProvider } from "./hosted-provider.js";

const pg = useVenueDb({
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
    // Immediate settlement, tip on the tender (zero here): sum(amount) = total 12.10 + tip 0.00.
    settlement: {
      kind: "immediate",
      tenders: [
        { method: "card", amount: tender.amount, tipAmount: "0.00", settledAt: tender.settledAt },
      ],
    },
    clock: steadyClock,
  };
}

describe("stripe hosted: initiate -> webhook -> settle -> recordSale -> associate (end to end)", () => {
  it("initiates, settles from the completed webhook, chains the sale, and associates the payment", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());
    const provider = new StripeHostedProvider({ client: new FakeStripeHosted(), db: pg.db });
    const paymentRef = randomUUID();

    // 1. initiate — mints the session, writes the initiated row (working order stays open).
    const init = await provider.initiate({
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      paymentRef,
    });

    // 2. The inbound webhook arrives (verified + parsed to the neutral event).
    const payload = FakeStripeHosted.event({
      sessionId: init.externalRef,
      type: "checkout.session.completed",
      amountTotalMinor: 1210,
      createdAt: BASE,
    });
    const event = provider.verifyAndParse(payload, "good");
    expect(event?.outcome).toBe("settled");

    // 3. The app-level orchestrator: confirm a local payment carries the session, then settle +
    //    chain + associate in one transaction.
    expect(await hasPaymentWithExternalRef(pg.db, event!.provider, event!.externalRef)).toBe(true);

    const saleId = await withTransaction(pg.db, async (tx) => {
      const row = await settleInitiated(tx, {
        provider: event!.provider,
        externalRef: event!.externalRef,
        settledAt: event!.settledAt,
      });
      expect(row).not.toBeNull();
      const recorded = await recordSale(
        tx,
        backend,
        buildInput(s, { amount: "12.10", settledAt: event!.settledAt }),
      );
      await associatePaymentWithSale(tx, {
        provider: "stripe",
        paymentRef,
        saleId: recorded.saleId,
      });
      return recorded.saleId;
    });

    // 4. After commit: the payment is captured, associated, and still carries the session external_ref.
    const finalRow = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, { provider: "stripe", paymentRef }),
    );
    expect(finalRow?.state).toBe("captured");
    expect(finalRow?.saleId).toBe(saleId);
    expect(finalRow?.externalRef).toBe(init.externalRef);
  });
});
