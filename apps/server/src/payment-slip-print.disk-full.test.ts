import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { billPayments, deviceProfiles, printJobs, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { cardReaders } from "@waitron/payments";
import { validateCapabilities } from "@waitron/layouts";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

let venue: BillVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await withTransaction(db, async (tx) => {
      for (const profile of await tx.select().from(deviceProfiles))
        await tx
          .update(deviceProfiles)
          .set({ capabilities: [...validateCapabilities(profile.capabilities), "print-receipt"] })
          .where(eq(deviceProfiles.id, profile.id));
      await tx.update(cardReaders).set({ printsOwnSlipAutomatically: false });
    });
  },
});

/**
 * From here until the case ends, queueing a document ends the whole transaction it is in, as a full
 * disk can (conventions-data.md, "A full disk sometimes ends the whole transaction"). A page limit
 * cannot stand in: there the slip's insert backed out alone and the transaction carried on.
 * `payment-slip-full-disk.e2e.test.ts` runs the real disk.
 */
function slipsEndTheirTransaction(): void {
  venue.db.run(sql`create temp trigger slip_ends_transaction before insert on print_jobs
    when new.kind = 'document' begin select raise(rollback, 'no room for the slip'); end`);
  onTestFinished(() => {
    venue.db.run(sql`drop trigger slip_ends_transaction`);
  });
}

function quietWarnings() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  onTestFinished(() => warn.mockRestore());
  return warn;
}

const pay = (id: string, extra: Record<string, unknown> = {}) =>
  send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount: "10.00",
    method: "card",
    entry: "reader",
    applied: "10.00",
    tip: "0.00",
    printCardSlip: true,
    ...extra,
  });

async function billPaymentOf(id: string) {
  const [row] = await venue.db
    .select()
    .from(billPayments)
    .where(eq(billPayments.workingOrderId, id));
  return row!;
}

const printJobCount = async () => (await venue.db.select().from(printJobs)).length;

describe("a slip the database has no room for", () => {
  it("leaves a payment the payment check finds charged received", async () => {
    const id = await tabWith(venue, "Red wine bottle");
    venue.card.crashNextCollect("captured");
    expect((await pay(id)).status).toBe(500);
    expect((await billPaymentOf(id)).state).toBe("pending");
    const before = await printJobCount();
    const warn = quietWarnings();
    slipsEndTheirTransaction();

    const pass = await settlePendingBillPayments({
      admission: testTradingAdmission(),
      db: venue.db,
      backend: venue.backend,
      clock: venue.clock,
      cfg: venue.cfg,
    });

    expect(pass).toMatchObject({ received: 1, errors: [] });
    expect((await billPaymentOf(id)).state).toBe("received");
    expect(await printJobCount()).toBe(before);
    expect(warn).toHaveBeenCalledWith(
      "receipt.optional_document_failed",
      expect.objectContaining({ operation: "printSettledPaymentSlip", workingOrderId: id }),
    );
  });

  it("leaves a card charged while the till waits received, and tells the till its slip failed", async () => {
    const id = await tabWith(venue, "Red wine bottle");
    const before = await printJobCount();
    quietWarnings();
    slipsEndTheirTransaction();

    const paid = await pay(id);

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json).toMatchObject({
      outcome: "received",
      slipPrintFailed: true,
      balance: { received: "10.00" },
    });
    expect((await billPaymentOf(id)).state).toBe("received");
    expect(await printJobCount()).toBe(before);
  });

  it.each([
    ["declines", () => venue.card.failNextCollect(), "declined"],
    ["has no network", () => venue.card.offlineNextCollect(), "network_unavailable"],
  ] as const)(
    "leaves a payment failed when the reader %s while the till waits",
    async (_, answer, outcome) => {
      const id = await tabWith(venue, "Red wine bottle");
      const before = await printJobCount();
      quietWarnings();
      slipsEndTheirTransaction();
      answer();

      const paid = await pay(id);

      expect(paid.status, JSON.stringify(paid.json)).toBe(200);
      expect(paid.json).toMatchObject({ outcome });
      // The till reads it as "Payment received, but the payment slip could not print."
      expect(paid.json).not.toHaveProperty("slipPrintFailed");
      expect((await billPaymentOf(id)).state).toBe("failed");
      expect(await printJobCount()).toBe(before);
    },
  );
});
