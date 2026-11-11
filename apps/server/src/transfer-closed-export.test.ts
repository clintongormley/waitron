import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { readOrderRevision } from "./working-order.js";
import { setOrderInvoiceChoice } from "./testing/order-writer-fixture.js";
import { inTx, seatedWith } from "./testing/bill-venue.js";
import { credit } from "./testing/order-venue.js";
import {
  RECIPIENT,
  clockAt,
  transferCloseVenue,
  type TransferCloseKit,
} from "./testing/transfer-close-fixture.js";
import { listTransferClosedInvoices } from "./transfer-closed-export.js";
import "./errors.js";

let t: TransferCloseKit;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    t = await transferCloseVenue(db);
  },
});

const HOUR = 3_600_000;
const days: { issued?: string; closedLater?: string; closedNow?: string } = {};
let laterBill = "";

function list(from: string, to: string) {
  return inTx(t.venue, (tx) => listTransferClosedInvoices(tx, { from, to }));
}

function closedDay(billId: string): string {
  const [row] = t.venue.db.all<{ day: string }>(
    sql`select business_day as day from transfer_closures where working_order_id = ${billId}`,
  );
  return row!.day;
}

describe("listTransferClosedInvoices", () => {
  it("filters by the day the bill was closed, not the day it was issued", async () => {
    laterBill = await t.counterOrder("placed", true);
    // 30 hours ahead, so the close lands on a later business day even before the 05:00 cutover.
    await t.close(
      await t.requestFor(laterBill, "18.00", null),
      t.depsWith({ clock: clockAt(Date.now() + 30 * HOUR) }),
    );
    const [sale] = t.venue.db.all<{ at: string; offset: number }>(
      sql`select issued_at as at, issued_offset_minutes as offset from sales where working_order_id = ${laterBill}`,
    );
    days.issued = new Date(Date.parse(sale!.at) + sale!.offset * 60_000).toISOString().slice(0, 10);
    days.closedLater = closedDay(laterBill);
    expect(days.closedLater > days.issued).toBe(true);

    expect(await list(days.closedLater, days.closedLater)).toEqual([
      {
        invoiceNumber: "A/1",
        invoiceType: "F2",
        issueDate: days.issued,
        closedOn: days.closedLater,
        recipientName: null,
        recipientTaxId: null,
        base: "14.88",
        vat: "3.12",
        total: "18.00",
        correctedBy: [],
        correctionsTotal: "0.00",
      },
    ]);
    expect(await list(days.issued, days.issued)).toEqual([]);
  });

  it("names a full invoice's customer", async () => {
    const party = await seatedWith(t.venue, "House salad");
    await setOrderInvoiceChoice(t.venue.db, t.venue.backend, t.venue.cfg, party.tabId, {
      revision: await inTx(t.venue, (tx) => readOrderRevision(tx, party.tabId)),
      invoiceType: "F1",
      recipient: RECIPIENT,
    });
    await t.close(await t.requestFor(party.tabId, "12.00", party.partyId));
    days.closedNow = closedDay(party.tabId);

    expect(await list(days.closedNow, days.closedNow)).toEqual([
      expect.objectContaining({
        invoiceType: "F1",
        recipientName: "Cliente SL",
        recipientTaxId: "B12345674",
        total: "12.00",
      }),
    ]);
  });

  it("names and totals a later credit without netting it off the invoice", async () => {
    await credit(t.venue, laterBill, "1.00", "-1.21");

    expect(await list(days.closedLater!, days.closedLater!)).toEqual([
      expect.objectContaining({
        invoiceNumber: "A/1",
        base: "14.88",
        vat: "3.12",
        total: "18.00",
        correctedBy: ["R/1"],
        correctionsTotal: "-1.21",
      }),
    ]);
  });

  it("orders the rows by the day each bill was closed", async () => {
    const rows = await list(days.closedNow!, days.closedLater!);

    expect(rows.map((row) => [row.invoiceType, row.closedOn])).toEqual([
      ["F1", days.closedNow],
      ["F2", days.closedLater],
    ]);
  });
});
