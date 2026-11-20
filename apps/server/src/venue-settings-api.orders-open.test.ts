import { testTradingAdmission } from "./testing/trading-admission.js";
import { observedOrderSender } from "./testing/order-writer-fixture.js";
import { observedRelocationSender } from "./testing/table-action-fixture.js";
import { observedBillActionBody } from "./testing/bill-action-fixture.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
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
import { setRoutingCell } from "@waitron/venue-service";
import { createStation } from "./kitchen.js";
import { ALL_MODULES } from "./modules.js";
import { mountVenueSettingsApi } from "./venue-settings-api.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import {
  cashPayment,
  provisionBillVenue,
  send as rawSend,
  seatedWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

// A receipt-language change is refused while an open order holds a line: the till can still move
// such a line to another bill, and the database's line triggers refuse that once the venue's
// language differs. A placed
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
    offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
  );
  const session = await withTransaction(venue.db, (tx) =>
    startManagementSession(tx, { method: "password", personId: venue.adminId }),
  );
  manager = `${MANAGEMENT_COOKIE}=${session.token}`;
});

const settings = new Hono();
beforeAll(() => {
  mountVenueSettingsApi(
    settings,
    {
      db: venue.db,
      fiscal: venueFiscalSelection(ALL_MODULES, "ES-common").contribution!,
    },
    () => {},
  );
});

const till = (method: string, path: string, body: unknown = {}) =>
  send(venue.app, venue.cookie, method, path, body);
const changeTo = (receiptLanguage: string) =>
  send(settings, manager, "PUT", "/management-api/venue-defaults", { receiptLanguage });

function rows<T>(query: ReturnType<typeof sql>): T[] {
  return venue.db.all<T>(query);
}
const language = () =>
  JSON.parse(
    rows<{ invoice_locales: string }>(
      sql`select json_extract(doc, '$.invoiceLocales') as invoice_locales from settings where module = 'venue'`,
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
const secondLineId = (orderId: string) =>
  rows<{ id: string }>(
    sql`select id from working_order_lines where working_order_id = ${orderId} and line_no = 2`,
  )[0]!.id;
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
    sql`update settings set doc = json_set(doc, '$.invoiceLocales', json('["es-ES"]')) where module = 'venue'`,
  );
  venue.db.run(sql`update working_order_lines set sent_at = '2026-01-01T00:00:00.000Z'
                   where sent_at is null and working_order_id in
                     (select id from working_orders where status = 'settled')`);
  venue.db.run(sql`delete from routing_cells`);
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
  const sold = await counterCash(id, "35.00", {
    lines: [{ menuItemId: counter.offerFor(productId("Paella")), quantity: "1" }],
  });
  expect(sold.status).toBe(200);
  return id;
}

function counterCash(
  id: string,
  tendered: string,
  basket: { lines: { menuItemId: string; quantity: string }[]; revision?: number },
) {
  return till("POST", `/api/working-orders/${id}/payments`, {
    submissionId: randomUUID(),
    kind: "share",
    shareOf: 1,
    method: "cash",
    tendered,
    dining: "eat_in",
    basket: { zoneId: counter.zoneId, ...basket },
  });
}

/** A seated party's bill with a Paella sent to the kitchen, paid in cash; the party stays seated. */
async function paidPartyBill(): Promise<{ partyId: string; tabId: string }> {
  const party = await seatedWith(venue, "Paella");
  const paid = await cashPayment(venue, venue.cookie, party.tabId, "35.00");
  expect(paid.status).toBe(200);
  expect(statusOf(party.tabId)).toBe("settled");
  return party;
}

describe("a receipt-language change while orders are open", () => {
  it("is refused while a counter order is parked, and accepted once it is paid", async () => {
    reset();
    const id = randomUUID();
    const parked = await till("POST", "/api/working-orders", {
      dining: "eat_in",
      id,
      zoneId: counter.zoneId,
      lines: [{ menuItemId: counter.offerFor(productId("Paella")), quantity: "1" }],
    });
    expect(parked.status).toBe(200);

    expect(await changeTo("gl-ES")).toEqual(refusedFor(1));
    expect(language()).toEqual(["es-ES"]);

    const paid = await counterCash(id, "35.00", {
      revision: parked.json.revision as number,
      lines: [{ menuItemId: counter.offerFor(productId("Paella")), quantity: "1" }],
    });
    expect(paid.status).toBe(200);
    expect(await changeTo("gl-ES")).toMatchObject({
      status: 200,
      json: { receiptLanguage: "gl-ES" },
    });
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
    expect(await changeTo("es-ES")).toMatchObject({
      status: 200,
      json: { receiptLanguage: "es-ES" },
    });
    expect(language()).toEqual(["es-ES"]);
  });

  it("is refused while a paid counter sale is still at the card reader, and accepted once it is filed", async () => {
    reset();
    const id = randomUUID();
    const calls = venue.card.collectCalls.length;
    const release = venue.card.holdNextCollect();
    const paying = till("POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      kind: "share",
      shareOf: 1,
      method: "card",
      entry: "reader",
      dining: "eat_in",
      basket: {
        zoneId: counter.zoneId,
        lines: [{ menuItemId: counter.offerFor(productId("Paella")), quantity: "1" }],
      },
    });
    try {
      await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));
      expect(
        rows<{ state: string }>(
          sql`select state from bill_payments where working_order_id = ${id}`,
        ),
      ).toEqual([{ state: "pending" }]);
      expect(await changeTo("gl-ES")).toEqual(refusedFor(1));
    } finally {
      release();
      await paying;
    }
    const paid = await paying;

    expect(paid.status).toBe(200);
    expect(paid.json).toMatchObject({ outcome: "received" });
    expect(statusOf(id)).toBe("settled");
    const [sale] = rows<{ locale: string }>(
      sql`select locale from sales where working_order_id = ${id}`,
    );
    expect(sale!.locale).toBe("es-ES");
    expect(await changeTo("gl-ES")).toMatchObject({
      status: 200,
      json: { receiptLanguage: "gl-ES" },
    });
  });

  it("accepts a change once every counter sale is paid and sent", async () => {
    reset();
    const id = await counterSale();
    expect(dishLines(id).every((line) => line.sent_at !== null && line.served_at === null)).toBe(
      true,
    );
    expect(await changeTo("gl-ES")).toMatchObject({
      status: 200,
      json: { receiptLanguage: "gl-ES" },
    });
  });

  it("accepts a change while a paid bill's party is seated, and its dishes can still be served", async () => {
    reset();
    const party = await paidPartyBill();
    const [line] = dishLines(party.tabId);
    expect(line!.served_at).toBeNull();

    expect(await changeTo("gl-ES")).toMatchObject({
      status: 200,
      json: { receiptLanguage: "gl-ES" },
    });
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

    expect(await changeTo("gl-ES")).toMatchObject({
      status: 200,
      json: { receiptLanguage: "gl-ES" },
    });

    const unserved = await till("POST", `/api/parties/${party.partyId}/unserved`, {
      submissionId: randomUUID(),
      expectedPartyRevision: revisionOf(party.partyId),
      items: [{ lineId: line!.id, quantity: "1" }],
    });
    expect(unserved.status).toBe(200);
    expect(dishLines(party.tabId)[0]!.served_at).toBeNull();
  });

  it("accepts a change while paid bills from a merge sit on a party still seated", async () => {
    reset();
    const survivor = await seatedWith(venue, "Tarta");
    const merged = await paidPartyBill();
    const table = rows<{ table_id: string }>(
      sql`select table_id from party_tables where party_id = ${merged.partyId} and left_at is null`,
    )[0]!.table_id;
    const joined = await till("POST", `/api/parties/${survivor.partyId}/join`, {
      tableId: table,
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
    ).toEqual([{ state: "open", party_id: survivor.partyId }]);
    const paid = await cashPayment(venue, venue.cookie, survivor.tabId, "18.00");
    expect(paid.status).toBe(200);
    expect(
      rows<{ state: string }>(sql`select state from parties where id = ${survivor.partyId}`),
    ).toEqual([{ state: "open" }]);

    expect(await changeTo("gl-ES")).toMatchObject({
      status: 200,
      json: { receiptLanguage: "gl-ES" },
    });
    expect(language()).toEqual(["gl-ES"]);
  });

  it("accepts a change while a paid counter sale holds a dish no station took", async () => {
    reset();
    const id = randomUUID();
    venue.db.run(sql`update kitchen_stations set active = 0`);
    try {
      const sold = await counterCash(id, "35.00", {
        lines: [{ menuItemId: counter.offerFor(productId("Paella")), quantity: "1" }],
      });
      expect(sold.status).toBe(200);
    } finally {
      venue.db.run(sql`update kitchen_stations set active = 1`);
    }
    expect(dishLines(id)[0]!.sent_at).toBeNull();

    expect(await changeTo("gl-ES")).toMatchObject({
      status: 200,
      json: { receiptLanguage: "gl-ES" },
    });
  });

  it("accepts a change while a paid sale holds an unsent dish beside one a station took", async () => {
    reset();
    await withTransaction(venue.db, async (tx) => {
      const grill = await createStation(tx, { name: "Plancha" });
      await setRoutingCell(
        tx,
        { row: { kind: "product", productId: productId("Paella") }, zoneId: null },
        { kind: "station", stationId: grill.id },
      );
    });
    const id = randomUUID();
    venue.db.run(sql`update kitchen_stations set active = 0 where is_default = 1`);
    try {
      const sold = await counterCash(id, "53.00", {
        lines: [
          { menuItemId: counter.offerFor(productId("Paella")), quantity: "1" },
          { menuItemId: counter.offerFor(productId("Tarta")), quantity: "1" },
        ],
      });
      expect(sold.status).toBe(200);
    } finally {
      venue.db.run(sql`update kitchen_stations set active = 1 where is_default = 1`);
    }
    expect(dishLines(id).map((line) => line.sent_at !== null)).toEqual([true, false]);
    expect(dishLines(id)[1]!.sent_at).toBeNull();

    expect(await changeTo("gl-ES")).toMatchObject({
      status: 200,
      json: { receiptLanguage: "gl-ES" },
    });
  });

  it("accepts a change while an order is placed, and the order can still be collected", async () => {
    reset();
    const placing = await withTransaction(venue.db, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
    );
    const id = randomUUID();
    try {
      const parked = await till("POST", "/api/working-orders", {
        dining: "eat_in",
        id,
        zoneId: placing.zoneId,
        lines: [{ menuItemId: placing.offerFor(productId("Paella")), quantity: "1" }],
      });
      expect(parked.status).toBe(200);
      const placed = await till("POST", `/api/working-orders/${id}/place`);
      expect(placed.status).toBe(200);
      expect(statusOf(id)).toBe("placed");

      expect(await changeTo("gl-ES")).toMatchObject({
        status: 200,
        json: { receiptLanguage: "gl-ES" },
      });

      const collected = await cashPayment(venue, venue.cookie, id, "35.00");
      expect(collected.status).toBe(200);
      expect(statusOf(id)).toBe("settled");
      expect(
        rows<{ locale: string }>(sql`select locale from sales where working_order_id = ${id}`),
      ).toEqual([{ locale: "gl-ES" }]);
      expect(
        rows<{ descriptions: string }>(
          sql`select sl.descriptions from sale_lines sl join sales s on s.id = sl.sale_id
              where s.working_order_id = ${id}`,
        ).map((line) => JSON.parse(line.descriptions) as unknown),
      ).toEqual([{ "es-ES": "Paella valenciana" }]);
    } finally {
      await withTransaction(venue.db, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
      );
    }
  });

  it("accepts a change while an already-issued order is placed, and collecting it keeps the language it was filed in", async () => {
    reset();
    const placing = await withTransaction(venue.db, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
    );
    const id = randomUUID();
    const filed = () => ({
      sales: rows<Record<string, unknown>>(sql`select * from sales where working_order_id = ${id}`),
      lines: rows<Record<string, unknown>>(
        sql`select sl.* from sale_lines sl join sales s on s.id = sl.sale_id
            where s.working_order_id = ${id} order by sl.line_no`,
      ),
    });
    try {
      const parked = await till("POST", "/api/working-orders", {
        dining: "eat_in",
        id,
        zoneId: placing.zoneId,
        lines: [{ menuItemId: placing.offerFor(productId("Paella")), quantity: "1" }],
      });
      expect(parked.status).toBe(200);
      await issueOrderInvoice(
        {
          admission: testTradingAdmission(),
          db: venue.db,
          backend: venue.backend,
          clock: venue.clock,
        },
        venue.cfg,
        id,
        venue.operatorId,
      );
      const placed = await till("POST", `/api/working-orders/${id}/place`);
      expect(placed.status).toBe(200);
      expect(statusOf(id)).toBe("placed");
      const before = filed();
      expect(before.sales).toEqual([expect.objectContaining({ locale: "es-ES" })]);
      expect(before.lines).toHaveLength(1);

      expect(await changeTo("gl-ES")).toMatchObject({
        status: 200,
        json: { receiptLanguage: "gl-ES" },
      });
      expect(language()).toEqual(["gl-ES"]);

      const collected = await cashPayment(venue, venue.cookie, id, "35.00");
      expect(collected.status).toBe(200);
      expect(statusOf(id)).toBe("settled");
      expect(filed()).toEqual(before);
    } finally {
      await withTransaction(venue.db, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
      );
    }
  });

  it("does not count a seated party's abandoned bill, which is no longer open", async () => {
    reset();
    const party = await seatedWith(venue, "Paella", "Tarta");
    const split = await till(
      "POST",
      `/api/bills/${party.tabId}/move-dishes`,
      await observedBillActionBody(venue.db, `/api/bills/${party.tabId}/move-dishes`, {
        expectedPartyRevision: revisionOf(party.partyId),
        lineIds: [secondLineId(party.tabId)],
        toBillId: null,
      }),
    );
    expect(split.status).toBe(200);
    const billId = split.json.billId as string;
    expect((await till("POST", `/api/working-orders/${billId}/place`)).status).toBe(200);
    expect(
      (await till("POST", `/api/working-orders/${billId}/cancel`, { reason: "Guest left" })).status,
    ).toBe(200);
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
    expect(serve).toMatchObject({ status: 400, json: { code: "group.not_found" } });
  });

  it("accepts a change while a seated party's bill holds no dish", async () => {
    reset();
    const party = await seatedWith(venue);
    expect(statusOf(party.tabId)).toBe("open");
    expect(await changeTo("gl-ES")).toMatchObject({
      status: 200,
      json: { receiptLanguage: "gl-ES" },
    });
  });

  // Why an open order holding a line still blocks. A language changed underneath one by direct SQL
  // leaves a dish move refused by the line triggers, and that surfaces as an unmapped 500 rather than
  // a named refusal: a known gap, kept here so a change to it is seen.
  it("a dish move off a bill holding a line fails once the language is changed underneath it, which is why such a bill blocks a change", async () => {
    reset();
    const party = await seatedWith(venue, "Paella", "Tarta");
    const before = dishLines(party.tabId);
    venue.db.run(
      sql`update settings set doc = json_set(doc, '$.invoiceLocales', json('["gl-ES"]')) where module = 'venue'`,
    );
    const split = await till(
      "POST",
      `/api/bills/${party.tabId}/move-dishes`,
      await observedBillActionBody(venue.db, `/api/bills/${party.tabId}/move-dishes`, {
        expectedPartyRevision: revisionOf(party.partyId),
        lineIds: [secondLineId(party.tabId)],
        toBillId: null,
      }),
    );
    expect(split).toMatchObject({ status: 500, json: { code: "server.internal" } });
    expect(dishLines(party.tabId)).toEqual(before);
  });
});

describe("PUT /management-api/venue-defaults while orders are open", () => {
  const vatClass = () =>
    rows<{ default_product_vat_class: string }>(
      sql`select json_extract(doc, '$.defaultProductVatClass') as default_product_vat_class from settings where module = 'menu'`,
    )[0]?.default_product_vat_class ?? "general";

  it("refuses a changed receipt language and writes neither it nor the VAT class beside it", async () => {
    reset();
    await seatedWith(venue, "Paella");
    const before = vatClass();
    expect(before).not.toBe("zero");

    const answer = await send(settings, manager, "PUT", "/management-api/venue-defaults", {
      receiptLanguage: "gl-ES",
      defaultProductVatClass: "zero",
    });

    expect(answer).toEqual(refusedFor(1));
    expect(language()).toEqual(["es-ES"]);
    expect(vatClass()).toBe(before);
  });
});

const send = observedRelocationSender(
  () => venue.db,
  observedOrderSender(() => venue.db, rawSend),
);
