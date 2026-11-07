import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction, writeNodeMembership } from "@waitron/db";
import { issuanceStopsRefund } from "./bill-refunds.js";
import {
  paymentRows,
  provisionBillVenue,
  send,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

let venue: BillVenue;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

async function chartNamingAnotherBoxPrimary() {
  await writeNodeMembership(suite.db, {
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
}

beforeEach(chartNamingAnotherBoxPrimary);
afterEach(async () => {
  await suite.db.execute(sql`delete from node_membership`);
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

describe("refunds on a box the held chart does not name primary", () => {
  it("records a confirmed hand-keyed card refund already made on the terminal", async () => {
    await suite.db.execute(sql`delete from node_membership`);
    const billId = await tabWith(venue, "Paella");
    const paid = await pay(billId, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "10.00",
      method: "card",
      entry: "manual",
      externalRef: "OP-1425",
      applied: "10.00",
      tip: "0.00",
    });
    expect(paid.status).toBe(200);
    const paymentId = (paid.json.payment as { id: string }).id;
    await chartNamingAnotherBoxPrimary();

    const refunded = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments/${paymentId}/refunds`,
      {
        submissionId: randomUUID(),
        reason: "Customer asked",
        override: { personId: venue.adminId, pin: "1234" },
        appliedAmount: "10.00",
        tipAmount: "0.00",
        manualConfirmed: true,
      },
    );

    expect(refunded.status).toBe(200);
    expect(refunded.json).toMatchObject({ refund: { paymentId, state: "completed" } });
  });

  it("leaves the refund catch-up loops running", async () => {
    await expect(
      withTransaction(suite.db, (tx) =>
        issuanceStopsRefund(tx, {
          db: suite.db,
          backend: venue.backend,
          clock: venue.clock,
          admission: { require: () => {} } as never,
          cfg: venue.cfg,
        }),
      ),
    ).resolves.toBe(false);
  });
});
