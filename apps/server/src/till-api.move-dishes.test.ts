import { writePartyAllergy } from "@waitron/venue-service";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import { seatTable } from "./parties.js";
import { createTable } from "./testing/live-table.js";
import {
  inTx,
  provisionBillVenue,
  registroCount,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import { openTillSession } from "./testing/session-device.js";
import { readBillEditState } from "./bill-editing.js";
import { saveDraftForTest } from "./testing/draft-command-fixture.js";
import { splitBill } from "./testing/bill-action-fixture.js";
import "./errors.js";

// The HTTP surface of Move dishes: the session guard, the body screens, the answer, the status of
// a refusal and the invoice a move can file. `moveDishes` itself is tested in `move-dishes.test.ts`.
let venue: BillVenue;
let operator: { personId: string; sessionId: string };

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    operator = {
      personId: venue.operatorId,
      sessionId: await openTillSession(db, {
        deviceId: venue.cfg.origin.deviceId,
        personId: venue.operatorId,
      }),
    };
  },
});

/** A party at a fresh table whose first bill holds one of each dish named, in order. */
async function seated(...names: string[]): Promise<{ partyId: string; tabId: string }> {
  return inTx(venue, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `Mesa ${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    });
    const { partyId, tabId } = await seatTable(tx, venue.cfg, {
      tableId: table.id,
      guestCount: null,
      operatorId: venue.operatorId,
    });
    await writePartyAllergy(tx, partyId, { answer: "none", guests: [] }, venue.operatorId);
    await addTabRound(
      tx,
      venue.cfg,
      tabId,
      names.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
    );
    return { partyId, tabId };
  });
}

/** A party with a first bill (Paella) and a second bill (Caña) split off it. */
async function twoBills(): Promise<{ partyId: string; first: string; second: string }> {
  const { partyId, tabId } = await seated("Paella", "Caña");
  const { billId } = await inTx(venue, (tx) =>
    splitBill(tx, venue.cfg, tabId, [{ lineNo: 2 }], {
      expectedPartyRevision: revisionOf(partyId),
      operatorId: venue.operatorId,
    }),
  );
  return { partyId, first: tabId, second: billId };
}

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

function lineIdsOf(billId: string): string[] {
  return venue.db
    .all<{
      id: string;
    }>(sql`select id from working_order_lines where working_order_id = ${billId} order by line_no`)
    .map((row) => row.id);
}

/** What the till sends: every bill's edit state it read, in bill-id order. */
async function editsOf(...billIds: string[]) {
  return inTx(venue, async (tx) => {
    const edits = [];
    for (const id of [...billIds].sort()) edits.push(await readBillEditState(tx, id));
    return edits;
  });
}

async function wellFormed(
  partyId: string,
  fromBillId: string,
  lineIds: string[],
  toBillId: string | null,
): Promise<Record<string, unknown>> {
  return {
    lineIds,
    toBillId,
    partyId,
    expectedPartyRevision: revisionOf(partyId),
    expectedEdits: await editsOf(fromBillId, ...(toBillId === null ? [] : [toBillId])),
  };
}

function post(fromBillId: string, body: unknown, cookie = venue.cookie) {
  return send(venue.app, cookie, "POST", `/api/bills/${fromBillId}/move-dishes`, body);
}

async function contribute(billId: string, amount: string): Promise<void> {
  await takeBillPayment(
    { db: venue.db, backend: venue.backend, clock: venue.clock },
    venue.cfg,
    billId,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
    },
    operator,
  );
}

function salesOf(billId: string) {
  return venue.db.all<{ invoiceNumber: number; total: string }>(sql`
    select invoice_number as invoiceNumber, cast(total as text) as total
    from sales where working_order_id = ${billId}
  `);
}

describe("A803 move dishes route:", () => {
  it("moving to a new bill answers 200 with the new bill's id", async () => {
    const { partyId, tabId } = await seated("Paella", "Caña");
    const [, caña] = lineIdsOf(tabId);

    const answer = await post(tabId, await wellFormed(partyId, tabId, [caña!], null));

    expect(answer.status).toBe(200);
    expect(Object.keys(answer.json)).toEqual(["billId"]);
    const billId = answer.json.billId as string;
    expect(billId).not.toBe(tabId);
    expect(await statusOf(venue, billId)).toBe("open");
    expect(lineIdsOf(billId)).toHaveLength(1);
    expect(lineIdsOf(tabId)).toHaveLength(1);
  });

  it("moving to an existing bill answers 200 with that bill's id", async () => {
    const { partyId, first, second } = await twoBills();
    const [paella] = lineIdsOf(first);

    const answer = await post(first, await wellFormed(partyId, first, [paella!], second));

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ billId: second });
    expect(lineIdsOf(second)).toHaveLength(2);
  });

  it("401 without a session", async () => {
    const { partyId, tabId } = await seated("Paella", "Caña");
    const [, caña] = lineIdsOf(tabId);

    const answer = await post(tabId, await wellFormed(partyId, tabId, [caña!], null), "");

    expect(answer.status).toBe(401);
    expect(answer.json).toMatchObject({ code: "session.required" });
  });

  it.each([
    ["missing", undefined],
    ["not a list", "x"],
    ["an empty string", [""]],
    ["not a UUID", ["not-a-uuid"]],
    ["not a string", [7]],
  ])(
    "lineIds %s is 400 management.request_invalid naming lineIds, changing nothing",
    async (_, lineIds) => {
      const { partyId, tabId } = await seated("Paella", "Caña");
      const body = await wellFormed(partyId, tabId, [], null);
      const revision = revisionOf(partyId);

      const answer = await post(tabId, { ...body, lineIds });

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: "lineIds" },
      });
      expect(revisionOf(partyId)).toBe(revision);
      expect(lineIdsOf(tabId)).toHaveLength(2);
    },
  );

  it("expectedEdits that are not a list are 400 management.request_invalid naming them", async () => {
    const { partyId, tabId } = await seated("Paella", "Caña");
    const [, caña] = lineIdsOf(tabId);
    const body = await wellFormed(partyId, tabId, [caña!], null);

    const answer = await post(tabId, { ...body, expectedEdits: "x" });

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "expectedEdits" },
    });
    expect(lineIdsOf(tabId)).toHaveLength(2);
  });

  it("a destination that is not a UUID is 409 tab.not_open", async () => {
    const { partyId, tabId } = await seated("Paella", "Caña");
    const [, caña] = lineIdsOf(tabId);
    const body = await wellFormed(partyId, tabId, [caña!], null);

    const answer = await post(tabId, { ...body, toBillId: "not-a-uuid" });

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "tab.not_open", params: { tabId: "not-a-uuid" } });
  });

  it("a paid dish is 409 bill.line_paid", async () => {
    const { partyId, tabId } = await seated("Paella", "Caña");
    const [paella] = lineIdsOf(tabId);
    await takeBillPayment(
      { db: venue.db, backend: venue.backend, clock: venue.clock },
      venue.cfg,
      tabId,
      {
        submissionId: randomUUID(),
        kind: "items",
        lines: [{ lineNo: 1 }],
        method: "cash",
        tendered: "35.00",
        applied: "35.00",
        tip: "0.00",
      },
      operator,
    );

    const answer = await post(tabId, await wellFormed(partyId, tabId, [paella!], null));

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "bill.line_paid" });
    expect(lineIdsOf(tabId)).toHaveLength(2);
  });

  it("a dish the bill does not hold is 404 tab.line_not_found", async () => {
    const { partyId, tabId } = await seated("Paella", "Caña");
    const missing = randomUUID();

    const answer = await post(tabId, await wellFormed(partyId, tabId, [missing], null));

    expect(answer.status).toBe(404);
    expect(answer.json).toMatchObject({ code: "tab.line_not_found" });
  });

  it("another person's unsent dishes on the bill are 409 draft.taken_over with the conflicts", async () => {
    const { partyId, tabId } = await seated("Paella", "Caña");
    const [, caña] = lineIdsOf(tabId);
    await inTx(venue, (tx) =>
      saveDraftForTest(tx, venue.cfg, partyId, venue.adminId, {
        billId: tabId,
        draftId: null,
        revision: 0,
        lines: [
          {
            menuItemId: venue.offerFor("Paella"),
            variantId: null,
            menuVersionId: null,
            quantity: "1",
            options: [],
            extras: [],
            note: null,
            courseId: null,
            noMerge: false,
            slot: 1,
            joinGroupId: null,
            afterGroupId: null,
          },
        ],
      }),
    );
    const revision = revisionOf(partyId);

    const answer = await post(tabId, await wellFormed(partyId, tabId, [caña!], null));

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({
      code: "draft.taken_over",
      params: { billId: tabId, ownerId: venue.adminId, conflicts: [{ billId: tabId }] },
    });
    expect(revisionOf(partyId)).toBe(revision);
    expect(lineIdsOf(tabId)).toHaveLength(2);
  });

  it("moving the last unpaid dishes off a bill whose contribution covers what stays files one invoice for it, and the moved dishes' new bill none", async () => {
    const { partyId, tabId } = await seated("Paella", "Caña");
    await contribute(tabId, "35.00");
    const [, caña] = lineIdsOf(tabId);
    expect(registroCount(venue, tabId)).toBe(0);

    const answer = await post(tabId, await wellFormed(partyId, tabId, [caña!], null));

    expect(answer.status).toBe(200);
    expect(await statusOf(venue, tabId)).toBe("settled");
    expect(registroCount(venue, tabId)).toBe(1);
    const sales = salesOf(tabId);
    expect(sales).toHaveLength(1);
    expect(sales[0]!.invoiceNumber).toBeGreaterThanOrEqual(1);
    expect(sales[0]!.total).toBe("3500");
    const moved = answer.json.billId as string;
    expect(registroCount(venue, moved)).toBe(0);
    expect(salesOf(moved)).toEqual([]);
    expect(await statusOf(venue, moved)).toBe("open");
  });

  it("a move that leaves the source owing files nothing", async () => {
    const { partyId, tabId } = await seated("Paella", "Caña", "Caña");
    await contribute(tabId, "35.00");
    const [, , caña] = lineIdsOf(tabId);

    const answer = await post(tabId, await wellFormed(partyId, tabId, [caña!], null));

    expect(answer.status).toBe(200);
    expect(await statusOf(venue, tabId)).toBe("open");
    expect(registroCount(venue, tabId)).toBe(0);
    expect(salesOf(tabId)).toEqual([]);
  });
});
