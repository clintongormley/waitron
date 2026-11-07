import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { writeNodeMembership } from "@waitron/db";
import {
  paymentRows,
  provisionBillVenue,
  send,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

let venue: BillVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await writeNodeMembership(db, {
      body: {
        term: 2,
        nodes: [
          { nodeId: venue.cfg.nodeId, contactUrl: "https://this-box", standing: "sell-only" },
          { nodeId: randomUUID(), contactUrl: "https://new-box", standing: "serving-primary" },
        ],
      },
      signerNodeId: "new-box",
      signature: "sig-2",
      endorsements: [],
    });
  },
});

function pay(billId: string, body: Record<string, unknown>) {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, body);
}

describe("bill payments on a box the held chart does not name primary", () => {
  it("refuses a reader payment before the reader is asked to charge", async () => {
    const billId = await tabWith(venue, "Paella");
    const before = venue.card.collectCalls.length;

    const refused = await pay(billId, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "10.00",
      method: "card",
      entry: "reader",
      applied: "10.00",
      tip: "0.00",
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual({
      code: "fiscal.chain_handed_over",
      params: { nodeId: venue.cfg.nodeId },
    });
    expect(venue.card.collectCalls.length).toBe(before);
    expect(await paymentRows(venue, billId)).toEqual([]);
  });

  it("refuses a cash payment before any payment is kept", async () => {
    const billId = await tabWith(venue, "Paella");

    const refused = await pay(billId, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "10.00",
      method: "cash",
      tendered: "10.00",
      applied: "10.00",
      tip: "0.00",
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual({
      code: "fiscal.chain_handed_over",
      params: { nodeId: venue.cfg.nodeId },
    });
    expect(await paymentRows(venue, billId)).toEqual([]);
  });
});
