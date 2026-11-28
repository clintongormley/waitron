import { testTradingAdmission } from "./testing/trading-admission.js";
import { readPartyAllergy, writeKitchenNote, writePartyAllergy } from "@waitron/venue-service";
import { addTabRound, setOrderInvoiceChoice } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import { holderOf, seatTable } from "./parties.js";
import { createTable } from "./testing/live-table.js";
import {
  inTx,
  provisionBillVenue,
  fiscalRecordCount,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import { openTillSession } from "./testing/session-device.js";
import { readBillEditState } from "./bill-editing.js";
import { saveDraftForTest } from "./testing/draft-command-fixture.js";
import { ACME } from "./testing/bill-invoice-fixture.js";
import { createOpenOrder } from "./working-order-open.js";
import { splitBill } from "./testing/bill-action-fixture.js";
import { createStation } from "./kitchen.js";
import { applyPartyAllergyPatch } from "./party-allergy.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { makeSharedPrinter } from "./testing/kitchen-print.test-support.js";
import { addFixtureExtra } from "./testing/portion-bill.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { readPartyKitchenNote } from "./order-kitchen-note.js";
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
async function seated(
  ...names: string[]
): Promise<{ partyId: string; tabId: string; tableId: string; label: string }> {
  return inTx(venue, async (tx) => {
    const label = `Mesa ${randomUUID().slice(0, 8)}`;
    const table = await createTable(tx, { label, zoneId: venue.zoneId });
    const { partyId, tabId } = await seatTable(tx, venue.cfg, {
      tableId: table.id,
      guestCount: null,
      operatorId: venue.operatorId,
    });
    await writePartyAllergy(tx, partyId, { answer: "none", guests: [] }, venue.operatorId);
    if (names.length > 0)
      await addTabRound(
        tx,
        venue.cfg,
        tabId,
        names.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
      );
    return { partyId, tabId, tableId: table.id, label };
  });
}

/** A party with a first bill (Seafood rice) and a second bill (Small beer) split off it. */
async function twoBills(): Promise<{ partyId: string; first: string; second: string }> {
  const { partyId, tabId } = await seated("Seafood rice", "Small beer");
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
    { db: venue.db, backend: venue.backend, clock: venue.clock, admission: testTradingAdmission() },
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

function pay(billId: string, body: Record<string, unknown>) {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    tip: "0.00",
    ...body,
  });
}

function paymentsRead(billId: string) {
  return send(venue.app, venue.cookie, "GET", `/api/working-orders/${billId}/payments`);
}

/** The names on the bill's invoice lines and the amounts of its tenders, in cents. */
function invoiced(billId: string): { names: string[]; tenders: number[] } {
  const names = venue.db
    .all<{ name: string }>(
      sql`select name from sale_lines where sale_id in (select id from sales where working_order_id = ${billId})`,
    )
    .map((row) => row.name);
  const tenders = venue.db
    .all<{ amount: number }>(
      sql`select amount from tenders where sale_id in (select id from sales where working_order_id = ${billId})`,
    )
    .map((row) => row.amount)
    .sort((a, b) => a - b);
  return { names, tenders };
}

async function toTable(
  source: { partyId: string; tabId: string },
  picks: string[],
  target: { tableId: string; partyId?: string; tabId?: string },
) {
  return {
    lineIds: picks,
    toTableId: target.tableId,
    partyId: source.partyId,
    expectedPartyRevision: revisionOf(source.partyId),
    otherPartyId: target.partyId ?? null,
    ...(target.partyId === undefined
      ? {}
      : { expectedOtherPartyRevision: revisionOf(target.partyId) }),
    expectedEdits: await editsOf(
      source.tabId,
      ...(target.tabId === undefined || target.tabId === source.tabId ? [] : [target.tabId]),
    ),
  };
}

describe("moving dishes to another table", () => {
  it("gives an occupied table a new bill and sends one slip from the original bill", async () => {
    const printerId = await inTx(venue, async (tx) => {
      const station = await createStation(tx, { name: "Dish moves" });
      for (const { id } of tx.all<{ id: string }>(
        sql`select id from products where name in ('Seafood rice', 'Small beer')`,
      )) {
        await routeProductTo(tx, id, station.id);
      }
      await setStationPrinting(tx, { printMovedSlips: true, printHeldWork: true }, [station.id]);
      return makeSharedPrinter(tx, "Dish move slips", [station.id]);
    });
    const source = await seated("Small beer", "Tarta");
    const target = await seated("Tarta");
    const [beer, cake] = lineIdsOf(source.tabId);
    const { rice, extra } = await inTx(venue, async (tx) => {
      await writeKitchenNote(tx, { partyId: source.partyId }, 0, "Bring cake at the end");
      await writeKitchenNote(tx, { partyId: target.partyId }, 0, "Change the cutlery");
      await placeGroups(tx, venue.cfg, source.partyId, {
        billId: source.tabId,
        operatorId: venue.operatorId,
        groups: [
          {
            release: "hold",
            lines: [{ menuItemId: venue.offerFor("Seafood rice"), quantity: "1" }],
          },
        ],
      });
      const [row] = tx.all<{ id: string }>(sql`
        select id from working_order_lines where working_order_id = ${source.tabId} and group_id is not null
      `);
      const ref = { kind: "working", id: beer! } as const;
      await applyPartyAllergyPatch(
        tx,
        source.partyId,
        {
          party: {
            answer: "allergies",
            guests: [{ who: "Guest", allergens: { eggs: {} }, note: null }],
          },
          ticks: [{ line: ref, guestIndex: 0 }],
        },
        venue.operatorId,
        [{ ref, workingLineId: beer!, draftLineId: null }],
      );
      return {
        rice: row!.id,
        extra: await addFixtureExtra(tx, venue.cfg, source.tabId, beer!, venue.offerFor("Tarta")),
      };
    });
    const printed = () =>
      venue.db
        .all<{ payload: Uint8Array }>(
          sql`select payload from print_jobs where printer_id = ${printerId} order by rowid`,
        )
        .map(({ payload }) => decodeTicket(payload));
    const count = printed().length;
    const numberOf = (id: string) =>
      venue.db.all<{ order_number: number }>(
        sql`select order_number from working_orders where id = ${id}`,
      )[0]!.order_number;
    const words = kitchenTicketWords("es");
    const targetLines = lineIdsOf(target.tabId);

    const answer = await post(source.tabId, await toTable(source, [beer!, rice], target));

    expect(answer.status).toBe(200);
    const moved = answer.json.billId as string;
    expect(moved).not.toBe(target.tabId);
    expect(lineIdsOf(source.tabId)).toEqual([cake]);
    expect(lineIdsOf(target.tabId)).toEqual(targetLines);
    expect(lineIdsOf(moved)).toEqual(expect.arrayContaining([beer, rice, extra]));
    await inTx(venue, async (tx) => {
      expect((await readPartyKitchenNote(tx, source.partyId)).note).toBe("Bring cake at the end");
      expect((await readPartyKitchenNote(tx, target.partyId)).note).toBe("Change the cutlery");
    });
    expect(
      venue.db.all(sql`
      select wo.party_id, wl.parent_line_id from working_orders wo
      join working_order_lines wl on wl.working_order_id = wo.id where wl.id = ${extra}
    `),
    ).toEqual([{ party_id: target.partyId, parent_line_id: beer }]);
    expect(
      venue.db.all(sql`
      select g.state from order_groups g join working_order_lines l on l.group_id = g.id
      where l.id = ${rice}
    `),
    ).toEqual([{ state: "held" }]);
    const allergy = await inTx(venue, (tx) => readPartyAllergy(tx, target.partyId));
    expect(allergy.guests.map(({ who }) => who)).toEqual(["Guest"]);
    expect(allergy.ticks.map(({ workingLineId }) => workingLineId)).toEqual([beer]);
    const slips = printed()
      .slice(count)
      .filter((paper) => paper.includes(words.moved));
    expect(slips).toEqual([
      expect.stringContaining(`${numberOf(source.tabId)} -> ${numberOf(moved)}`),
    ]);
    expect(slips[0]).toContain(`${words.fromPlace}${source.label}`);
    expect(slips[0]).toContain(`${words.toPlace}${target.label}`);
    expect(slips[0]).toContain("BEER SMALL");
    expect(slips[0]).toContain(words.hold);
    expect(slips[0]).toContain("RICE PAN");
  });

  it("seats a free table and puts the selected dish on its new bill", async () => {
    const source = await seated("Seafood rice", "Small beer");
    const [rice, beer] = lineIdsOf(source.tabId);
    const table = await inTx(venue, async (tx) => {
      await writeKitchenNote(tx, { partyId: source.partyId }, 0, "Bring cake at the end");
      return createTable(tx, { label: "Free table for dishes", zoneId: venue.zoneId });
    });

    const answer = await post(source.tabId, await toTable(source, [beer!], { tableId: table.id }));

    expect(answer.status).toBe(200);
    const bill = answer.json.billId as string;
    const partyId = await inTx(venue, (tx) => holderOf(tx, table.id));
    expect(partyId).not.toBeNull();
    expect(partyId).not.toBe(source.partyId);
    expect((await inTx(venue, (tx) => readPartyKitchenNote(tx, partyId!))).note).toBeNull();
    expect(venue.db.all(sql`select id from working_orders where party_id = ${partyId}`)).toEqual([
      { id: bill },
    ]);
    expect(lineIdsOf(bill)).toEqual([beer]);
    expect(lineIdsOf(source.tabId)).toEqual([rice]);
  });

  it("rolls back the split when the bill move refuses a table already held by that party", async () => {
    const source = await seated("Seafood rice", "Small beer");
    const lines = lineIdsOf(source.tabId);
    const revision = revisionOf(source.partyId);

    const answer = await post(source.tabId, await toTable(source, [lines[1]!], source));

    expect(answer).toEqual({
      status: 409,
      json: { code: "table.already_in_party", params: { tableId: source.tableId } },
    });
    expect(lineIdsOf(source.tabId)).toEqual(lines);
    expect(revisionOf(source.partyId)).toBe(revision);
    expect(
      venue.db.all(sql`select id from working_orders where party_id = ${source.partyId}`),
    ).toEqual([{ id: source.tabId }]);
  });

  it("carries the chosen full invoice to an occupied table when every dish leaves", async () => {
    const source = await seated("Seafood rice");
    const target = await seated("Small beer");
    const [bill] = venue.db.all<{ revision: number }>(
      sql`select revision from working_orders where id = ${source.tabId}`,
    );
    await setOrderInvoiceChoice(venue.db, venue.backend, venue.cfg, source.tabId, {
      revision: bill!.revision,
      invoiceType: "F1",
      recipient: ACME,
    });
    const lines = lineIdsOf(source.tabId);

    const answer = await post(source.tabId, {
      ...(await toTable(source, lines, target)),
      invoiceChoice: { keep: "from", from: { taxId: ACME.taxId }, into: null },
    });

    expect(answer.status).toBe(200);
    const moved = answer.json.billId as string;
    expect(moved).not.toBe(target.tabId);
    expect(lineIdsOf(moved)).toEqual(lines);
    expect(
      venue.db.all(sql`
      select party_id, invoice_type, recipient_tax_id from working_orders where id = ${moved}
    `),
    ).toEqual([{ party_id: target.partyId, invoice_type: "F1", recipient_tax_id: ACME.taxId }]);
  });

  it("refuses a Counter order before creating a new bill at the table", async () => {
    const counter = randomUUID();
    const target = await seated();
    await inTx(venue, (tx) => createOpenOrder(tx, venue.cfg, counter, [], null));
    const lines = lineIdsOf(counter);

    const answer = await post(counter, {
      lineIds: lines,
      toTableId: target.tableId,
      otherPartyId: target.partyId,
      expectedOtherPartyRevision: revisionOf(target.partyId),
      expectedEdits: await editsOf(counter, target.tabId),
    });

    expect(answer).toEqual({
      status: 409,
      json: { code: "bill.not_at_table", params: { workingOrderId: counter } },
    });
    expect(lineIdsOf(counter)).toEqual(lines);
  });
});

describe("A803 move dishes route:", () => {
  it("moving to a new bill answers 200 with the new bill's id", async () => {
    const { partyId, tabId } = await seated("Seafood rice", "Small beer");
    const [, beerLineId] = lineIdsOf(tabId);

    const answer = await post(tabId, await wellFormed(partyId, tabId, [beerLineId!], null));

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
    const [riceLine] = lineIdsOf(first);

    const answer = await post(first, await wellFormed(partyId, first, [riceLine!], second));

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ billId: second });
    expect(lineIdsOf(second)).toHaveLength(2);
  });

  it("a dish's id spelled in upper case moves that dish", async () => {
    const { partyId, tabId } = await seated("Seafood rice", "Small beer");
    const [, beerLineId] = lineIdsOf(tabId);

    const answer = await post(
      tabId,
      await wellFormed(partyId, tabId, [beerLineId!.toUpperCase()], null),
    );

    expect(answer.status).toBe(200);
    expect(lineIdsOf(answer.json.billId as string)).toEqual([beerLineId]);
    expect(lineIdsOf(tabId)).toHaveLength(1);
  });

  it("401 without a session", async () => {
    const { partyId, tabId } = await seated("Seafood rice", "Small beer");
    const [, beerLineId] = lineIdsOf(tabId);

    const answer = await post(tabId, await wellFormed(partyId, tabId, [beerLineId!], null), "");

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
      const { partyId, tabId } = await seated("Seafood rice", "Small beer");
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
    const { partyId, tabId } = await seated("Seafood rice", "Small beer");
    const [, beerLineId] = lineIdsOf(tabId);
    const body = await wellFormed(partyId, tabId, [beerLineId!], null);

    const answer = await post(tabId, { ...body, expectedEdits: "x" });

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "expectedEdits" },
    });
    expect(lineIdsOf(tabId)).toHaveLength(2);
  });

  it("a body without toBillId is 400 management.request_invalid naming it, opening no bill", async () => {
    const { partyId, tabId } = await seated("Seafood rice", "Small beer");
    const [, beerLineId] = lineIdsOf(tabId);
    const body = await wellFormed(partyId, tabId, [beerLineId!], null);
    delete body.toBillId;
    const revision = revisionOf(partyId);

    const answer = await post(tabId, body);

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "toBillId" },
    });
    expect(revisionOf(partyId)).toBe(revision);
    expect(lineIdsOf(tabId)).toHaveLength(2);
    expect(
      venue.db.all(sql`select id from working_orders where party_id = ${partyId}`),
    ).toHaveLength(1);
  });

  it("a destination that is not a UUID is 409 tab.not_open", async () => {
    const { partyId, tabId } = await seated("Seafood rice", "Small beer");
    const [, beerLineId] = lineIdsOf(tabId);
    const body = await wellFormed(partyId, tabId, [beerLineId!], null);

    const answer = await post(tabId, { ...body, toBillId: "not-a-uuid" });

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "tab.not_open", params: { tabId: "not-a-uuid" } });
  });

  it("the bill as its own destination is 400 tab.transfer_self", async () => {
    const { partyId, first } = await twoBills();
    const [riceLine] = lineIdsOf(first);

    const body = await wellFormed(partyId, first, [riceLine!], null);

    const answer = await post(first, { ...body, toBillId: first });

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({ code: "tab.transfer_self", params: { tabId: first } });
    expect(lineIdsOf(first)).toEqual([riceLine]);
  });

  it("the same dish named twice is 400 tab.transfer_duplicate_line", async () => {
    const { partyId, first, second } = await twoBills();
    const [riceLine] = lineIdsOf(first);

    const answer = await post(
      first,
      await wellFormed(partyId, first, [riceLine!, riceLine!], second),
    );

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({
      code: "tab.transfer_duplicate_line",
      params: { tabId: first, lineNo: 1 },
    });
    expect(lineIdsOf(first)).toEqual([riceLine]);
    expect(lineIdsOf(second)).toHaveLength(1);
  });

  it("a dish the bill does not hold is 400 tab.line_not_found", async () => {
    const { partyId, tabId } = await seated("Seafood rice", "Small beer");
    const missing = randomUUID();

    const answer = await post(tabId, await wellFormed(partyId, tabId, [missing], null));

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({ code: "tab.line_not_found" });
  });

  it("another person's unsent dishes on the bill are 409 draft.taken_over with the conflicts", async () => {
    const { partyId, tabId } = await seated("Seafood rice", "Small beer");
    const [, beerLineId] = lineIdsOf(tabId);
    await inTx(venue, (tx) =>
      saveDraftForTest(tx, partyId, venue.adminId, {
        billId: tabId,
        draftId: null,
        revision: 0,
        lines: [
          {
            menuItemId: venue.offerFor("Seafood rice"),
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

    const answer = await post(tabId, await wellFormed(partyId, tabId, [beerLineId!], null));

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({
      code: "draft.taken_over",
      params: { billId: tabId, ownerId: venue.adminId, conflicts: [{ billId: tabId }] },
    });
    expect(revisionOf(partyId)).toBe(revision);
    expect(lineIdsOf(tabId)).toHaveLength(2);
  });

  it("moving the last unpaid dishes off a bill whose contribution covers what stays files one invoice for it, and the moved dishes' new bill none", async () => {
    const { partyId, tabId } = await seated("Seafood rice", "Small beer");
    await contribute(tabId, "35.00");
    const [, beerLineId] = lineIdsOf(tabId);
    expect(fiscalRecordCount(venue, tabId)).toBe(0);

    const answer = await post(tabId, await wellFormed(partyId, tabId, [beerLineId!], null));

    expect(answer.status).toBe(200);
    expect(await statusOf(venue, tabId)).toBe("settled");
    expect(fiscalRecordCount(venue, tabId)).toBe(1);
    const sales = salesOf(tabId);
    expect(sales).toHaveLength(1);
    expect(sales[0]!.invoiceNumber).toBeGreaterThanOrEqual(1);
    expect(sales[0]!.total).toBe("3500");
    const moved = answer.json.billId as string;
    expect(fiscalRecordCount(venue, moved)).toBe(0);
    expect(salesOf(moved)).toEqual([]);
    expect(await statusOf(venue, moved)).toBe("open");
  });

  it("a move that leaves the source owing files nothing", async () => {
    const { partyId, tabId } = await seated("Seafood rice", "Small beer", "Small beer");
    await contribute(tabId, "35.00");
    const [, , beerLineId] = lineIdsOf(tabId);

    const answer = await post(tabId, await wellFormed(partyId, tabId, [beerLineId!], null));

    expect(answer.status).toBe(200);
    expect(await statusOf(venue, tabId)).toBe("open");
    expect(fiscalRecordCount(venue, tabId)).toBe(0);
    expect(salesOf(tabId)).toEqual([]);
  });

  it.each([
    ["cash", { method: "cash", tendered: "35.00" }],
    ["a hand-keyed card", { method: "card", entry: "manual" }],
    ["a reader card", { method: "card", entry: "reader" }],
  ])(
    "a dish moved onto a bill holding a part payment of 35.00 in %s leaves that payment as it was, and paying the rest files one invoice holding the moved dish and both payments",
    async (_, tender) => {
      const { partyId, tabId } = await seated("Seafood rice", "Small beer", "Steak", "Tarta");
      const { billId: destination } = await inTx(venue, (tx) =>
        splitBill(tx, venue.cfg, tabId, [{ lineNo: 1 }, { lineNo: 2 }], {
          expectedPartyRevision: revisionOf(partyId),
          operatorId: venue.operatorId,
        }),
      );
      const paid = await pay(destination, {
        kind: "contribution",
        amount: "35.00",
        applied: "35.00",
        ...tender,
      });
      expect(paid.status, JSON.stringify(paid.json)).toBe(200);
      const before = await paymentsRead(destination);
      expect(before.json).toMatchObject({ total: "38.00", received: "35.00", outstanding: "3.00" });
      const [, cakeLineId] = lineIdsOf(tabId);

      const moved = await post(tabId, await wellFormed(partyId, tabId, [cakeLineId!], destination));

      expect(moved.status, JSON.stringify(moved.json)).toBe(200);
      const after = await paymentsRead(destination);
      expect(after.json).toMatchObject({ total: "56.00", received: "35.00", outstanding: "21.00" });
      expect(after.json.payments).toEqual(before.json.payments);
      expect(lineIdsOf(destination)).toContain(cakeLineId);
      expect(fiscalRecordCount(venue, destination)).toBe(0);

      const rest = await pay(destination, {
        kind: "contribution",
        amount: "21.00",
        method: "cash",
        tendered: "21.00",
        applied: "21.00",
      });

      expect(rest.status, JSON.stringify(rest.json)).toBe(200);
      expect(await statusOf(venue, destination)).toBe("settled");
      expect(fiscalRecordCount(venue, destination)).toBe(1);
      expect(salesOf(destination).map((sale) => sale.total)).toEqual(["5600"]);
      expect(invoiced(destination).names).toContain("Tarta");
      expect(invoiced(destination).tenders).toEqual([2100, 3500]);
    },
  );

  it("a move that leaves the source paid in full files its invoice alone, and the part-paid destination stays open", async () => {
    const { partyId, tabId } = await seated("Seafood rice", "Small beer", "Steak");
    const { billId: destination } = await inTx(venue, (tx) =>
      splitBill(tx, venue.cfg, tabId, [{ lineNo: 3 }], {
        expectedPartyRevision: revisionOf(partyId),
        operatorId: venue.operatorId,
      }),
    );
    await contribute(tabId, "35.00");
    await contribute(destination, "1.00");
    const [, beerLineId] = lineIdsOf(tabId);

    const moved = await post(tabId, await wellFormed(partyId, tabId, [beerLineId!], destination));

    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    expect(await statusOf(venue, tabId)).toBe("settled");
    expect(fiscalRecordCount(venue, tabId)).toBe(1);
    expect(salesOf(tabId).map((sale) => sale.total)).toEqual(["3500"]);
    expect(await statusOf(venue, destination)).toBe("open");
    expect(fiscalRecordCount(venue, destination)).toBe(0);
    expect(salesOf(destination)).toEqual([]);
    expect((await paymentsRead(destination)).json).toMatchObject({
      total: "28.00",
      received: "1.00",
      outstanding: "27.00",
    });
  });
});
