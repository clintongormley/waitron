import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decimal } from "@waitron/shared";
import "./errors.js";
import { createTable } from "./testing/live-table.js";
import { observedBillActionBody } from "./testing/bill-action-fixture.js";
import { observedTableActionBody } from "./testing/table-action-fixture.js";
import {
  provisionBillVenue,
  registroCount,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { mountTillApi, type TillApiDeps } from "./till-api.js";
import { TradingAdmission } from "./trading-admission.js";

// Split a table through its route to a genuine chained fiscal record: what a split leaves paid is
// issued in the request's transaction, and a refusal at any invoice takes back the whole split.
let venue: BillVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

function mounted(overrides: Partial<TillApiDeps>): Hono {
  const app = new Hono();
  mountTillApi(
    app,
    {
      admission: testTradingAdmission(),
      db: venue.db,
      backend: venue.backend,
      clock: venue.clock,
      cfg: venue.cfg,
      secureCookies: false,
      venueLocale: venue.cfg.locale,
      ...overrides,
    },
    () => {},
  );
  return app;
}

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

function lineIdsOf(billId: string): string[] {
  return venue.db
    .all<{ id: string }>(
      sql`select id from working_order_lines where working_order_id = ${billId} order by line_no`,
    )
    .map((row) => row.id);
}

function namesOn(billId: string): string[] {
  return venue.db
    .all<{ name: string }>(
      sql`select name from working_order_lines where working_order_id = ${billId} order by line_no`,
    )
    .map((row) => row.name);
}

function salesOf(billId: string) {
  return venue.db.all<{ invoiceNumber: number; total: string }>(sql`
    select invoice_number as invoiceNumber, cast(total as text) as total
    from sales where working_order_id = ${billId}
  `);
}

function counts() {
  const [row] = venue.db.all<{ sales: number; records: number; parties: number }>(sql`
    select
      (select count(*) from sales) as sales,
      (select count(*) from registros_facturacion) as records,
      (select count(*) from parties) as parties
  `);
  return row!;
}

function lastInvoiceNumber(): number {
  const [row] = venue.db.all<{ last: number | null }>(
    sql`select max(invoice_number) as last from sales`,
  );
  return row!.last ?? 0;
}

function recordOf(billId: string) {
  const [row] = venue.db.all<{
    numSerie: string;
    huella: string;
    previousNumSerie: string | null;
    previousHuella: string | null;
  }>(sql`
    select r.num_serie_factura as numSerie, r.huella as huella,
      r.anterior_num_serie_factura as previousNumSerie, r.anterior_huella as previousHuella
    from registros_facturacion r join sales s on s.id = r.sale_id
    where s.working_order_id = ${billId}
  `);
  return row!;
}

function operatorOfSale(billId: string): string | null {
  const [row] = venue.db.all<{ operatorId: string | null }>(
    sql`select operator_id as operatorId from sales where working_order_id = ${billId}`,
  );
  return row!.operatorId;
}

function frozenLabelOf(billId: string): string | null {
  const [row] = venue.db.all<{ label: string | null }>(
    sql`select label from working_orders where id = ${billId}`,
  );
  return row!.label;
}

function tableLabelOf(tableId: string): string {
  const [row] = venue.db.all<{ label: string }>(
    sql`select label from dining_tables where id = ${tableId}`,
  );
  return row!.label;
}

function partyOfBill(billId: string): string {
  const [row] = venue.db.all<{ partyId: string }>(
    sql`select party_id as partyId from working_orders where id = ${billId}`,
  );
  return row!.partyId;
}

function joinedTo(partyId: string): string[] {
  return venue.db
    .all<{ tableId: string }>(
      sql`select table_id as tableId from party_tables where party_id = ${partyId} and left_at is null`,
    )
    .map((row) => row.tableId);
}

/** A party at two tables, whose first bill holds one of each dish named. */
async function atTwoTables(...names: string[]) {
  const party = await seatedWith(venue, ...names);
  const { id: leaving } = await withTransaction(venue.db, (tx) =>
    createTable(tx, venue.cfg, {
      label: `Mesa ${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    }),
  );
  const path = `/api/parties/${party.partyId}/join`;
  const joined = await send(
    venue.app,
    venue.cookie,
    "POST",
    path,
    await observedTableActionBody(venue.db, path, {
      tableId: leaving,
      expectedPartyRevision: revisionOf(party.partyId),
    }),
  );
  expect(joined.status, JSON.stringify(joined.json)).toBe(200);
  return { partyId: party.partyId, tabId: party.tabId, first: party.tableId, leaving };
}

/**
 * {@link atTwoTables} with Bill 1 of Caña, Caña and Bill 2 of Paella, Caña, each holding the
 * contribution that picking its last Caña leaves exact. The picks list Bill 2 first.
 */
async function twoBillsLeftPaidByAPick() {
  const { partyId, tabId: bill1, leaving } = await atTwoTables("Caña", "Caña", "Paella", "Caña");
  const path = `/api/bills/${bill1}/split`;
  const split = await send(
    venue.app,
    venue.cookie,
    "POST",
    path,
    await observedBillActionBody(venue.db, path, {
      transfers: [{ lineNo: 3 }, { lineNo: 4 }],
      expectedPartyRevision: revisionOf(partyId),
    }),
  );
  expect(split.status, JSON.stringify(split.json)).toBe(200);
  const bill2 = split.json.billId as string;
  await contribute(bill1, "3.00");
  await contribute(bill2, "35.00");
  return {
    partyId,
    leaving,
    bill1,
    bill2,
    picks: [
      { billId: bill2, lineIds: [lineIdsOf(bill2).at(-1)!] },
      { billId: bill1, lineIds: [lineIdsOf(bill1).at(-1)!] },
    ],
  };
}

async function contribute(billId: string, amount: string): Promise<void> {
  const paid = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
    },
  );
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
}

async function payFor(billId: string, lineNo: number, amount: string): Promise<void> {
  const paid = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    {
      submissionId: randomUUID(),
      kind: "items",
      lines: [{ lineNo }],
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
    },
  );
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
}

async function split(
  partyId: string,
  tableId: string,
  selection: { wholeBillIds: string[]; loose: { billId: string; lineIds: string[] }[] },
  app: Hono = venue.app,
) {
  const path = `/api/parties/${partyId}/split-table`;
  return send(
    app,
    venue.cookie,
    "POST",
    path,
    await observedTableActionBody(venue.db, path, {
      tableId,
      selection,
      expectedPartyRevision: revisionOf(partyId),
    }),
  );
}

describe("A803 split: issuance", () => {
  it("a loose pick of the last unpaid dish of an item-paid bill issues its one invoice, on the staying party", async () => {
    const { partyId, tabId, first, leaving } = await atTwoTables("Paella", "Caña");
    await payFor(tabId, 1, "35.00");
    const [, beerLineId] = lineIdsOf(tabId);
    expect(registroCount(venue, tabId)).toBe(0);

    const answer = await split(partyId, leaving, {
      wholeBillIds: [],
      loose: [{ billId: tabId, lineIds: [beerLineId!] }],
    });

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(salesOf(tabId)).toHaveLength(1);
    expect(salesOf(tabId)[0]!.total).toBe("3500");
    expect(registroCount(venue, tabId)).toBe(1);
    expect(await statusOf(venue, tabId)).toBe("settled");
    expect(partyOfBill(tabId)).toBe(partyId);
    expect(operatorOfSale(tabId)).toBe(venue.operatorId);
    expect(frozenLabelOf(tabId)).toBe(tableLabelOf(first));
  });

  it("when the party's first table is the one taken away, the invoice names the table that stays", async () => {
    const { partyId, tabId, first, leaving } = await atTwoTables("Paella", "Caña");
    await payFor(tabId, 1, "35.00");
    const [, beerLineId] = lineIdsOf(tabId);

    const answer = await split(partyId, first, {
      wholeBillIds: [],
      loose: [{ billId: tabId, lineIds: [beerLineId!] }],
    });

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(partyOfBill(tabId)).toBe(partyId);
    expect(operatorOfSale(tabId)).toBe(venue.operatorId);
    expect(frozenLabelOf(tabId)).toBe(tableLabelOf(leaving));
  });

  it("the new bill holds no sale", async () => {
    const { partyId, tabId, leaving } = await atTwoTables("Paella", "Caña");
    await payFor(tabId, 1, "35.00");
    const [, beerLineId] = lineIdsOf(tabId);

    const answer = await split(partyId, leaving, {
      wholeBillIds: [],
      loose: [{ billId: tabId, lineIds: [beerLineId!] }],
    });

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const [newBill] = answer.json.billIds as string[];
    expect(namesOn(newBill!)).toEqual(["Caña"]);
    expect(salesOf(newBill!)).toEqual([]);
    expect(registroCount(venue, newBill!)).toBe(0);
    expect(await statusOf(venue, newBill!)).toBe("open");
  });

  it.each<[string, (billId: string) => Promise<void>]>([
    ["an item payment", (billId) => payFor(billId, 1, "35.00")],
    ["a contribution", (billId) => contribute(billId, "35.00")],
  ])("a whole bill part-paid by %s issues nothing", async (_, paying) => {
    const { partyId, tabId, leaving } = await atTwoTables("Paella", "Caña");
    await paying(tabId);

    const answer = await split(partyId, leaving, { wholeBillIds: [tabId], loose: [] });

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json.billIds).toEqual([tabId]);
    expect(salesOf(tabId)).toEqual([]);
    expect(registroCount(venue, tabId)).toBe(0);
    expect(await statusOf(venue, tabId)).toBe("open");
  });

  it("a split with no loose dish goes while the box's trading state would refuse an invoice", async () => {
    const { partyId, tabId, leaving } = await atTwoTables("Paella", "Caña");
    await contribute(tabId, "35.00");

    const answer = await split(
      partyId,
      leaving,
      { wholeBillIds: [tabId], loose: [] },
      mounted({ admission: new TradingAdmission() }),
    );

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(salesOf(tabId)).toEqual([]);
  });

  it("a loose pick that leaves the source still owing issues nothing", async () => {
    const { partyId, tabId, leaving } = await atTwoTables("Paella", "Caña", "Caña");
    await contribute(tabId, "35.00");
    const beerLineId = lineIdsOf(tabId).at(-1)!;

    const answer = await split(partyId, leaving, {
      wholeBillIds: [],
      loose: [{ billId: tabId, lineIds: [beerLineId] }],
    });

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(salesOf(tabId)).toEqual([]);
    expect(registroCount(venue, tabId)).toBe(0);
    expect(await statusOf(venue, tabId)).toBe("open");
  });

  it("a refusal by the trading admission rolls the whole split back", async () => {
    const { partyId, tabId, leaving } = await atTwoTables("Paella", "Caña");
    await contribute(tabId, "35.00");
    const [, beerLineId] = lineIdsOf(tabId);
    const before = counts();
    const revision = revisionOf(partyId);

    const answer = await split(
      partyId,
      leaving,
      { wholeBillIds: [], loose: [{ billId: tabId, lineIds: [beerLineId!] }] },
      mounted({ admission: new TradingAdmission() }),
    );

    expect(answer.status).toBeGreaterThanOrEqual(400);
    expect(answer.json).toMatchObject({ code: "venue.time_zone_not_ready" });
    expect(counts()).toEqual(before);
    expect(joinedTo(partyId)).toContain(leaving);
    expect(revisionOf(partyId)).toBe(revision);
    expect(namesOn(tabId)).toEqual(["Paella", "Caña"]);
    expect(await statusOf(venue, tabId)).toBe("open");
  });

  it("two loose sources left paid make two invoices, in bill-number order, the second chained on the first", async () => {
    const { partyId, leaving, bill1, bill2, picks } = await twoBillsLeftPaidByAPick();

    const answer = await split(partyId, leaving, { wholeBillIds: [], loose: picks });

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await statusOf(venue, bill1)).toBe("settled");
    expect(await statusOf(venue, bill2)).toBe("settled");
    const [first] = salesOf(bill1);
    const [second] = salesOf(bill2);
    expect(salesOf(bill1)).toHaveLength(1);
    expect(salesOf(bill2)).toHaveLength(1);
    expect(first!.invoiceNumber).toBeLessThan(second!.invoiceNumber);
    expect(recordOf(bill2).previousNumSerie).toBe(recordOf(bill1).numSerie);
    expect(recordOf(bill2).previousHuella).toBe(recordOf(bill1).huella);
    const [newBill] = answer.json.billIds as string[];
    expect(namesOn(newBill!)).toEqual(["Caña", "Caña"]);
    expect(salesOf(newBill!)).toEqual([]);
  });

  it("a refusal at the second invoice leaves no sale and no record, and takes no number", async () => {
    const { partyId, leaving, bill1, bill2, picks } = await twoBillsLeftPaidByAPick();
    const before = counts();
    const last = lastInvoiceNumber();
    const limited = mounted({ cfg: { ...venue.cfg, simplifiedInvoiceLimit: decimal("10.00") } });

    const answer = await split(partyId, leaving, { wholeBillIds: [], loose: picks }, limited);

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "sale.total_exceeds_simplified_limit" });
    expect(await statusOf(venue, bill1)).toBe("open");
    expect(await statusOf(venue, bill2)).toBe("open");
    expect(salesOf(bill1)).toEqual([]);
    expect(salesOf(bill2)).toEqual([]);
    expect(registroCount(venue, bill1)).toBe(0);
    expect(registroCount(venue, bill2)).toBe(0);
    expect(counts()).toEqual(before);
    expect(joinedTo(partyId)).toContain(leaving);

    const again = await split(partyId, leaving, { wholeBillIds: [], loose: picks });

    expect(again.status, JSON.stringify(again.json)).toBe(200);
    expect(salesOf(bill1)[0]!.invoiceNumber).toBe(last + 1);
    expect(salesOf(bill2)[0]!.invoiceNumber).toBe(last + 2);
  });

  it("a loose split records the kitchen activity of each source and the new bill, and a whole one of neither", async () => {
    const recorder = vi.fn(() => Promise.resolve());
    const app = mounted({ attendance: recorder });
    const keys = () =>
      recorder.mock.calls
        .map((call: unknown[]) => (call[1] as { key: string }).key)
        .filter((key) => key.startsWith("service:"));

    const looseParty = await atTwoTables("Paella", "Caña");
    const [, beerLineId] = lineIdsOf(looseParty.tabId);
    const loose = await split(
      looseParty.partyId,
      looseParty.leaving,
      { wholeBillIds: [], loose: [{ billId: looseParty.tabId, lineIds: [beerLineId!] }] },
      app,
    );
    expect(loose.status, JSON.stringify(loose.json)).toBe(200);
    const [newBill] = loose.json.billIds as string[];
    expect(
      keys()
        .map((key) => key.split(":")[1])
        .sort(),
    ).toEqual([looseParty.tabId, newBill!].sort());

    recorder.mockClear();
    const wholeParty = await atTwoTables("Paella");
    const whole = await split(
      wholeParty.partyId,
      wholeParty.leaving,
      { wholeBillIds: [wholeParty.tabId], loose: [] },
      app,
    );
    expect(whole.status, JSON.stringify(whole.json)).toBe(200);
    expect(keys()).toEqual([]);
  });
});
