import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { startManagementSession } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { venueFiscalSelection } from "@waitron/provisioning";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { createException } from "@waitron/venue-service";
import { createStation } from "./kitchen.js";
import { ALL_MODULES } from "./modules.js";
import { mountLocationSettingsApi } from "./location-settings-api.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { provisionBillVenue, send, seatedWith, type BillVenue } from "./testing/bill-venue.js";
import "./errors.js";

// A receipt-language change is refused while an open order at the location holds a line: the till
// can still split such a line, inserting a copy keyed under the old language, or move it to another
// bill, and the database's line triggers refuse both once the location's language differs. A placed
// or paid order's lines, and an open order with none, take no such write, so they do not block.
let venue: BillVenue;
let counter: ZoneOffers;
let manager: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

beforeAll(async () => {
  counter = await withTransaction(venue.db, (tx) =>
    offerProducts(tx, venue.cfg, { zone: "counter", serviceMode: "prepay" }),
  );
  const session = await withTransaction(venue.db, (tx) =>
    startManagementSession(tx, { personId: venue.adminId }),
  );
  manager = `${MANAGEMENT_COOKIE}=${session.token}`;
});

const settings = new Hono();
beforeAll(() => {
  mountLocationSettingsApi(
    settings,
    {
      db: venue.db,
      cfg: venue.cfg,
      fiscal: venueFiscalSelection(ALL_MODULES, "ES-common").contribution!,
    },
    () => {},
  );
});

const till = (method: string, path: string, body: unknown = {}) =>
  send(venue.app, venue.cookie, method, path, body);
const changeTo = (language: string) =>
  send(settings, manager, "PUT", "/management-api/receipt-language", { language });

function rows<T>(query: ReturnType<typeof sql>): T[] {
  return venue.db.all<T>(query);
}
const language = () =>
  JSON.parse(
    rows<{ invoice_locales: string }>(
      sql`select invoice_locales from locations where id = ${venue.cfg.locationId}`,
    )[0]!.invoice_locales,
  ) as string[];
const statusOf = (orderId: string) =>
  rows<{ status: string }>(sql`select status from working_orders where id = ${orderId}`)[0]!.status;
const revisionOf = (partyId: string) =>
  rows<{ revision: number }>(sql`select revision from parties where id = ${partyId}`)[0]!.revision;
const dishLines = (orderId: string) =>
  rows<{ id: string; sent_at: string | null; served_at: string | null }>(
    sql`select id, sent_at, served_at from working_order_lines
        where working_order_id = ${orderId} and parent_line_id is null order by line_no`,
  );
const productId = (name: string) =>
  rows<{ id: string }>(sql`select id from products where name = ${name}`)[0]!.id;

/**
 * Back to Spanish with nothing left that blocks a change, so no case depends on the ones before it:
 * every unpaid order abandoned, every party closed, every paid line stamped sent (a case's orders
 * are all keyed in Spanish), and the kitchen routing put back. Written directly, because a case may
 * leave a party seated with an unpaid bill.
 */
function reset(): void {
  venue.db.run(
    sql`update working_orders set status = 'abandoned' where status in ('open', 'placed')`,
  );
  venue.db.run(sql`update parties set state = 'closed', closed_at = '2026-01-01T00:00:00.000Z',
                   closed_by = ${venue.operatorId} where state = 'open'`);
  venue.db.run(
    sql`update locations set invoice_locales = '["es-ES"]' where id = ${venue.cfg.locationId}`,
  );
  venue.db.run(sql`update working_order_lines set sent_at = '2026-01-01T00:00:00.000Z'
                   where sent_at is null and working_order_id in
                     (select id from working_orders where status = 'settled')`);
  venue.db.run(sql`delete from route_exceptions`);
  venue.db.run(sql`update kitchen_stations set active = 1 where is_default = 1`);
}

function refusedFor(count: number) {
  return {
    status: 409,
    json: {
      code: "receipt.language_orders_open",
      params: { field: "receiptLanguage", count },
    },
  };
}

/** A walk-up counter sale of one Paella, paid in cash. */
async function counterSale(): Promise<string> {
  const id = randomUUID();
  const sold = await till("POST", "/api/sales", {
    workingOrderId: id,
    zoneId: counter.zoneId,
    lines: [{ menuItemId: counter.offerFor(productId("Paella")), quantity: "1" }],
    tender: { method: "cash", amount: "35.00" },
  });
  expect(sold.status).toBe(200);
  return id;
}

/** A seated party's bill with a Paella sent to the kitchen, paid in cash; the party stays seated. */
async function paidPartyBill(): Promise<{ partyId: string; tabId: string }> {
  const party = await seatedWith(venue, "Paella");
  const paid = await till("POST", "/api/sales", {
    workingOrderId: party.tabId,
    lines: [],
    tender: { method: "cash", amount: "35.00" },
  });
  expect(paid.status).toBe(200);
  expect(statusOf(party.tabId)).toBe("settled");
  return party;
}

describe("a receipt-language change while orders are open", () => {
  it("is refused while a counter order is parked, and accepted once it is paid", async () => {
    reset();
    const id = randomUUID();
    const parked = await till("POST", "/api/working-orders", {
      id,
      zoneId: counter.zoneId,
      lines: [{ menuItemId: counter.offerFor(productId("Paella")), quantity: "1" }],
    });
    expect(parked.status).toBe(200);

    expect(await changeTo("gl-ES")).toEqual(refusedFor(1));
    expect(language()).toEqual(["es-ES"]);

    const paid = await till("POST", "/api/sales", {
      workingOrderId: id,
      lines: [{ menuItemId: counter.offerFor(productId("Paella")), quantity: "1" }],
      tender: { method: "cash", amount: "35.00" },
    });
    expect(paid.status).toBe(200);
    expect(await changeTo("gl-ES")).toMatchObject({ status: 204 });
    expect(language()).toEqual(["gl-ES"]);
  });

  it("counts every blocking order", async () => {
    reset();
    await seatedWith(venue, "Paella");
    await seatedWith(venue, "Tarta");
    expect(await changeTo("gl-ES")).toEqual(refusedFor(2));
  });

  it("accepts the language already saved while an order is open, writing nothing new", async () => {
    reset();
    await seatedWith(venue, "Paella");
    expect(await changeTo("es-ES")).toMatchObject({ status: 204 });
    expect(language()).toEqual(["es-ES"]);
  });

  it("is refused while a paid counter sale is still at the card reader, and accepted once it is filed", async () => {
    reset();
    const id = randomUUID();
    const calls = venue.card.collectCalls.length;
    const release = venue.card.holdNextCollect();
    const paying = till("POST", "/api/pay", {
      id,
      zoneId: counter.zoneId,
      lines: [{ menuItemId: counter.offerFor(productId("Paella")), quantity: "1" }],
    });
    await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));
    expect(
      rows<{ payment_attempt_at: string | null }>(
        sql`select payment_attempt_at from working_orders where id = ${id}`,
      )[0]!.payment_attempt_at,
    ).not.toBeNull();

    const during = await changeTo("gl-ES");
    release();
    const paid = await paying;

    expect(during).toEqual(refusedFor(1));
    expect(paid.status).toBe(200);
    expect(paid.json).toMatchObject({ outcome: "captured" });
    expect(statusOf(id)).toBe("settled");
    const [sale] = rows<{ locale: string }>(
      sql`select locale from sales where working_order_id = ${id}`,
    );
    expect(sale!.locale).toBe("es-ES");
    expect(await changeTo("gl-ES")).toMatchObject({ status: 204 });
  });

  it("accepts a change once every counter sale is paid and sent, as nothing can write their lines", async () => {
    reset();
    const id = await counterSale();
    expect(dishLines(id).every((line) => line.sent_at !== null && line.served_at === null)).toBe(
      true,
    );
    expect(await changeTo("gl-ES")).toMatchObject({ status: 204 });
    const prep = await till("POST", `/api/working-orders/${id}/prep`);
    expect(prep.json).toMatchObject({ code: "ticket.already_fired" });
  });

  it("accepts a change while a paid bill's party is seated, and its dishes can still be served", async () => {
    reset();
    const party = await paidPartyBill();
    const [line] = dishLines(party.tabId);
    expect(line!.served_at).toBeNull();

    expect(await changeTo("gl-ES")).toMatchObject({ status: 204 });
    expect(language()).toEqual(["gl-ES"]);

    const served = await till("POST", `/api/parties/${party.partyId}/served`, {
      submissionId: randomUUID(),
      expectedPartyRevision: revisionOf(party.partyId),
      items: [{ lineId: line!.id, quantity: "1" }],
    });
    expect(served.status).toBe(200);
    expect(dishLines(party.tabId)[0]!.served_at).not.toBeNull();
  });

  it("accepts a change while a seated party's paid bill is fully served, and the serve can still be taken back", async () => {
    reset();
    const party = await paidPartyBill();
    const [line] = dishLines(party.tabId);
    const served = await till("POST", `/api/parties/${party.partyId}/served`, {
      submissionId: randomUUID(),
      expectedPartyRevision: revisionOf(party.partyId),
      items: [{ lineId: line!.id, quantity: "1" }],
    });
    expect(served.status).toBe(200);
    expect(dishLines(party.tabId)[0]!.served_at).not.toBeNull();

    expect(await changeTo("gl-ES")).toMatchObject({ status: 204 });

    const unserved = await till("POST", `/api/parties/${party.partyId}/unserved`, {
      submissionId: randomUUID(),
      expectedPartyRevision: revisionOf(party.partyId),
      items: [{ lineId: line!.id, quantity: "1" }],
    });
    expect(unserved.status).toBe(200);
    expect(dishLines(party.tabId)[0]!.served_at).toBeNull();
  });

  it("accepts a change while a paid bill sits on a party merged into one still seated", async () => {
    reset();
    const survivor = await seatedWith(venue, "Tarta");
    const merged = await paidPartyBill();
    const table = rows<{ table_id: string }>(
      sql`select table_id from party_tables where party_id = ${merged.partyId} and left_at is null`,
    )[0]!.table_id;
    const joined = await till("POST", `/api/parties/${survivor.partyId}/join`, {
      tableId: table,
      bills: "merge",
      expectedPartyRevision: revisionOf(survivor.partyId),
      otherPartyId: merged.partyId,
      expectedOtherPartyRevision: revisionOf(merged.partyId),
    });
    expect(joined.status).toBe(200);
    expect(
      rows<{ state: string; party_id: string }>(
        sql`select p.state, wo.party_id from working_orders wo join parties p on p.id = wo.party_id
            where wo.id = ${merged.tabId}`,
      ),
    ).toEqual([{ state: "closed", party_id: merged.partyId }]);
    const paid = await till("POST", "/api/sales", {
      workingOrderId: survivor.tabId,
      lines: [],
      tender: { method: "cash", amount: "18.00" },
    });
    expect(paid.status).toBe(200);
    expect(
      rows<{ state: string }>(sql`select state from parties where id = ${survivor.partyId}`),
    ).toEqual([{ state: "open" }]);

    expect(await changeTo("gl-ES")).toMatchObject({ status: 204 });
    expect(language()).toEqual(["gl-ES"]);
  });

  it("accepts a change while a paid counter sale holds a dish no station took, which the send route then sends", async () => {
    reset();
    const id = randomUUID();
    venue.db.run(sql`update kitchen_stations set active = 0`);
    try {
      const sold = await till("POST", "/api/sales", {
        workingOrderId: id,
        zoneId: counter.zoneId,
        lines: [{ menuItemId: counter.offerFor(productId("Paella")), quantity: "1" }],
        tender: { method: "cash", amount: "35.00" },
      });
      expect(sold.status).toBe(200);
    } finally {
      venue.db.run(sql`update kitchen_stations set active = 1`);
    }
    expect(dishLines(id)[0]!.sent_at).toBeNull();

    expect(await changeTo("gl-ES")).toMatchObject({ status: 204 });

    expect((await till("POST", `/api/working-orders/${id}/prep`)).status).toBe(200);
    expect(dishLines(id)[0]!.sent_at).not.toBeNull();
  });

  it("accepts a change while a paid sale holds an unsent dish beside one a station took, which the send route refuses", async () => {
    reset();
    await withTransaction(venue.db, async (tx) => {
      const grill = await createStation(tx, venue.cfg, { name: "Plancha" });
      await createException(tx, venue.cfg, {
        zoneId: null,
        categoryId: null,
        productId: productId("Paella"),
        target: { kind: "station", stationId: grill.id },
      });
    });
    const id = randomUUID();
    venue.db.run(sql`update kitchen_stations set active = 0 where is_default = 1`);
    try {
      const sold = await till("POST", "/api/sales", {
        workingOrderId: id,
        zoneId: counter.zoneId,
        lines: [
          { menuItemId: counter.offerFor(productId("Paella")), quantity: "1" },
          { menuItemId: counter.offerFor(productId("Tarta")), quantity: "1" },
        ],
        tender: { method: "cash", amount: "53.00" },
      });
      expect(sold.status).toBe(200);
    } finally {
      venue.db.run(sql`update kitchen_stations set active = 1 where is_default = 1`);
    }
    expect(dishLines(id).map((line) => line.sent_at !== null)).toEqual([true, false]);
    const prep = await till("POST", `/api/working-orders/${id}/prep`);
    expect(prep).toMatchObject({ status: 409, json: { code: "ticket.already_fired" } });
    expect(dishLines(id)[1]!.sent_at).toBeNull();

    expect(await changeTo("gl-ES")).toMatchObject({ status: 204 });

    const before = dishLines(id);
    const after = await till("POST", `/api/working-orders/${id}/prep`);
    expect(after).toMatchObject({ status: 409, json: { code: "ticket.already_fired" } });
    expect(dishLines(id)).toEqual(before);
  });

  it("accepts a change while an order is placed, and the order can still be collected", async () => {
    reset();
    const placing = await withTransaction(venue.db, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", serviceMode: "ticket_then_pay" }),
    );
    const id = randomUUID();
    try {
      const parked = await till("POST", "/api/working-orders", {
        id,
        zoneId: placing.zoneId,
        lines: [{ menuItemId: placing.offerFor(productId("Paella")), quantity: "1" }],
      });
      expect(parked.status).toBe(200);
      const placed = await till("POST", `/api/working-orders/${id}/place`);
      expect(placed.status).toBe(200);
      expect(statusOf(id)).toBe("placed");

      expect(await changeTo("gl-ES")).toMatchObject({ status: 204 });

      const collected = await till("POST", `/api/working-orders/${id}/collect`, {
        tender: { method: "cash", amount: "35.00" },
      });
      expect(collected.status).toBe(200);
      expect(statusOf(id)).toBe("settled");
      expect(
        rows<{ locale: string }>(sql`select locale from sales where working_order_id = ${id}`),
      ).toEqual([{ locale: "gl-ES" }]);
    } finally {
      await withTransaction(venue.db, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", serviceMode: "prepay" }),
      );
    }
  });

  it("does not count a seated party's abandoned bill, which no route serves", async () => {
    reset();
    const party = await seatedWith(venue, "Paella", "Tarta");
    const split = await till("POST", `/api/bills/${party.tabId}/split`, {
      expectedPartyRevision: revisionOf(party.partyId),
      transfers: [{ lineNo: 2 }],
    });
    expect(split.status).toBe(200);
    const billId = split.json.billId as string;
    expect((await till("DELETE", `/api/working-orders/${billId}`)).status).toBe(200);
    expect(statusOf(billId)).toBe("abandoned");
    const [line] = dishLines(billId);
    expect(line!.sent_at).not.toBeNull();
    expect(line!.served_at).toBeNull();

    expect(await changeTo("gl-ES")).toEqual(refusedFor(1));

    const serve = await till("POST", `/api/parties/${party.partyId}/served`, {
      submissionId: randomUUID(),
      expectedPartyRevision: revisionOf(party.partyId),
      items: [{ lineId: line!.id, quantity: "1" }],
    });
    expect(serve).toMatchObject({ status: 404, json: { code: "group.not_found" } });
  });

  it("accepts a change while a seated party's bill holds no dish", async () => {
    reset();
    const party = await seatedWith(venue);
    expect(statusOf(party.tabId)).toBe("open");
    expect(await changeTo("gl-ES")).toMatchObject({ status: 204 });
  });

  // Why an open order holding a line still blocks. A language changed underneath one by direct SQL
  // leaves its split refused by the line triggers, and that surfaces as an unmapped 500 rather than
  // a named refusal: a known gap, kept here so a change to it is seen.
  it("a split on an open bill fails once the language is changed underneath it", async () => {
    reset();
    const party = await seatedWith(venue, "Paella", "Tarta");
    const before = dishLines(party.tabId);
    venue.db.run(
      sql`update locations set invoice_locales = '["gl-ES"]' where id = ${venue.cfg.locationId}`,
    );
    const split = await till("POST", `/api/bills/${party.tabId}/split`, {
      expectedPartyRevision: revisionOf(party.partyId),
      transfers: [{ lineNo: 2 }],
    });
    expect(split).toMatchObject({ status: 500, json: { code: "server.internal" } });
    expect(dishLines(party.tabId)).toEqual(before);
  });
});
