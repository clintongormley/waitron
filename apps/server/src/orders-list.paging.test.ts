import { beforeEach, describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { invoiceSeries, withTransaction } from "@waitron/db";
import { seriesId } from "@waitron/shared";
import { seatedWith, send } from "./testing/bill-venue.js";
import {
  billlessSale,
  parked,
  placedIssuedBill,
  credit,
  provisionOrderVenue,
  type OrderVenue,
} from "./testing/order-venue.js";
import * as orders from "./orders-list.js";

let venue: OrderVenue;
const testDb = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
});
beforeEach(async () => {
  venue = await provisionOrderVenue(testDb.db);
});
const filter: orders.OrderListFilter = {
  status: "all",
  dates: "any",
  credited: false,
  limit: 50,
  scope: "all",
};
const request = { page: 0, sortKey: "" as const, sortDirection: "descending" as const };
const ids = (rows: orders.OrderRow[]) => rows.map((row) => row.id);
const read = (query = request, where = filter) =>
  withTransaction(venue.db, (tx) => orders.listOrdersTablePage(tx, where, query));

describe("Orders table pages", () => {
  it("returns disjoint 50-row pages, the matching total and a clamped last page", async () => {
    for (let n = 0; n < 101; n++) await parked(venue, "Red wine bottle");
    const first = await read();
    const second = await read({ ...request, page: 1 });
    const last = await read({ ...request, page: 999 });
    expect(first).toMatchObject({ total: 101, page: 0, pageSize: 50 });
    expect(second).toMatchObject({ total: 101, page: 1, pageSize: 50 });
    expect(last).toMatchObject({ total: 101, page: 2, pageSize: 50 });
    expect(first.rows).toHaveLength(50);
    expect(second.rows).toHaveLength(50);
    expect(last.rows).toHaveLength(1);
    expect(new Set([...ids(first.rows), ...ids(second.rows), ...ids(last.rows)]).size).toBe(101);
    const empty = await read({ ...request, page: 99 }, { ...filter, status: "paid" });
    expect(empty).toEqual({ rows: [], total: 0, page: 0, pageSize: 50 });
    const found = await read(request, { ...filter, search: String(last.rows[0]!.orderNumber) });
    expect(found.total).toBe(1);
    expect(ids(found.rows)).toEqual(ids(last.rows));
  });

  it("sorts opened timestamps in either direction and keeps descending ids for ties", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-04-04T12:00:00.000Z") });
    let old: string, pair: string[];
    try {
      old = await parked(venue, "Red wine bottle");
      vi.setSystemTime(new Date("2026-04-05T12:00:00.000Z"));
      pair = [await parked(venue, "Red wine bottle"), await parked(venue, "Red wine bottle")];
    } finally {
      vi.useRealTimers();
    }
    for (const direction of ["ascending", "descending"] as const) {
      const page = await withTransaction(venue.db, (tx) =>
        orders.listOrdersTablePage(tx, filter, {
          ...request,
          sortKey: "opened",
          sortDirection: direction,
        }),
      );
      expect(ids(page.rows)).toEqual(
        direction === "ascending"
          ? [old!, ...pair!.sort().reverse()]
          : [...pair!.sort().reverse(), old!],
      );
    }
  });

  it("sorts numeric invoice numbers and totals, putting uninvoiced bills last in either invoice direction", async () => {
    const invoices: string[] = [];
    for (let n = 0; n < 10; n++) invoices.push(await placedIssuedBill(venue, "Red wine bottle"));
    const larger = await parked(venue, ...Array<string>(4).fill("Red wine bottle"));
    for (const direction of ["ascending", "descending"] as const) {
      const invoice = await withTransaction(venue.db, (tx) =>
        orders.listOrdersTablePage(tx, filter, {
          ...request,
          sortKey: "invoice",
          sortDirection: direction,
        }),
      );
      expect(ids(invoice.rows)).toEqual([
        ...(direction === "ascending" ? invoices : [...invoices].reverse()),
        larger,
      ]);
      const total = await withTransaction(venue.db, (tx) =>
        orders.listOrdersTablePage(tx, filter, {
          ...request,
          sortKey: "total",
          sortDirection: direction,
        }),
      );
      expect(total.rows[direction === "ascending" ? 10 : 0]!.id).toBe(larger);
    }
    await credit(venue, invoices[0]!, "2.00", "-2.42");
    const sortedAfterCredit = await withTransaction(venue.db, (tx) =>
      orders.listOrdersTablePage(tx, filter, {
        ...request,
        sortKey: "total",
        sortDirection: "ascending",
      }),
    );
    expect(sortedAfterCredit.rows[0]!.id).toBe(invoices[9]);
    const credited = await read(request, { ...filter, credited: true, staffId: venue.operatorId });
    expect(credited.total).toBe(1);
    expect(credited.rows[0]).toMatchObject({
      id: invoices[0],
      total: "30.00",
      stillOwed: "27.58",
      credited: "in_part",
      staff: [{ id: venue.operatorId, name: "Anna" }],
    });
    expect(credited.rows[0]!.correctives).toHaveLength(1);
  });

  it("sorts mixed-case series codes before the invoice number in either direction", async () => {
    for (const code of ["UPPER", "lower", "Middle"]) {
      const [series] = await withTransaction(venue.db, (tx) =>
        tx
          .insert(invoiceSeries)
          .values({ nodeId: venue.cfg.nodeId, code })
          .returning({ id: invoiceSeries.id }),
      );
      await billlessSale({ ...venue, seriesId: seriesId(series!.id) });
      if (code === "lower") await billlessSale({ ...venue, seriesId: seriesId(series!.id) });
    }
    for (const direction of ["ascending", "descending"] as const) {
      const page = await withTransaction(venue.db, (tx) =>
        orders.listOrdersTablePage(tx, filter, {
          ...request,
          sortKey: "invoice",
          sortDirection: direction,
        }),
      );
      expect(page.rows.map((row) => row.invoiceNumber)).toEqual(
        direction === "ascending"
          ? ["lower/1", "lower/2", "Middle/1", "UPPER/1"]
          : ["UPPER/1", "Middle/1", "lower/2", "lower/1"],
      );
    }
  });

  it("keeps relevance ahead of an explicit sort and filters matching totals before paging", async () => {
    const pair: string[] = [];
    for (const name of ["Quokka", "Quokkahouse"]) {
      const party = await seatedWith(venue, "Red wine bottle");
      expect(
        (
          await send(venue.app, venue.cookie, "PUT", `/api/parties/${party.partyId}/name`, {
            name,
            expectedPartyRevision: party.revision,
          })
        ).status,
      ).toBe(200);
      pair.push(party.tabId);
    }
    await parked(venue, "Red wine bottle");
    const page = await withTransaction(venue.db, (tx) =>
      orders.listOrdersTablePage(
        tx,
        { ...filter, search: "quokka" },
        { ...request, sortKey: "opened", sortDirection: "descending" },
      ),
    );
    expect(page.total).toBe(2);
    expect(ids(page.rows)).toEqual(pair);
    expect(page.rows[0]!.tables).not.toEqual([]);
    expect((await read(request, { ...filter, search: "quokka " })).total).toBe(1);
  });
});
