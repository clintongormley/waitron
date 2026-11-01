import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { invoiceSeries, type Database } from "@waitron/db";
import { seedNode } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { TrustedClock } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import {
  inTx,
  partyRevisionOf,
  provisionBillVenue,
  registroCount,
  send,
  type BillVenue,
} from "./testing/bill-venue.js";
import { seedFiscalRegistro } from "./testing/fiscal-fixtures.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { createTable } from "./testing/live-table.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { systemClock } from "./till-backend.js";
import { parkOrder } from "./working-order.js";
import "./errors.js";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MIGRATIONS = migrationOptionsFor(manifestSets(), null);

interface OpenVenue {
  venue: BillVenue;
  counter: ZoneOffers;
  productId: string;
}

/** A bill venue whose counter offers every dish, and whose "Counter till" profile, and so every
 * device on it, may print and clock in. */
async function openVenue(db: Database): Promise<OpenVenue> {
  const venue = await provisionBillVenue(db);
  const counter = await inTx(venue, (tx) => offerProducts(tx, venue.cfg));
  const [dish] = db.all<{ id: string }>(sql`select id from products where name = 'Paella'`);
  db.run(sql`
    update device_profiles
    set capabilities = json_insert(json_insert(capabilities, '$[#]', 'print-receipt'), '$[#]', 'clock-in')
    where name = 'Counter till'
  `);
  return { venue, counter, productId: dish!.id };
}

function clockAt(ms: number): TrustedClock {
  const base = systemClock();
  const reading = { ...base.now(), instant: new Date(ms), offsetMinutes: 60 };
  return { ...base, now: () => reading };
}

function latest(db: Database): { at: Date; offsetMinutes: number } | undefined {
  const [row] = db.all<{ at: string; offsetMinutes: number }>(sql`
    select fecha_hora_huso_gen_registro as at, offset_minutos as offsetMinutes
    from registros_facturacion
    order by fecha_hora_huso_gen_registro desc, id desc
    limit 1
  `);
  return row === undefined ? undefined : { at: new Date(row.at), offsetMinutes: row.offsetMinutes };
}

function count(db: Database, table: string, where = sql`1 = 1`): number {
  const [row] = db.all<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(table)} where ${where}`,
  );
  return row!.n;
}

function cashSale(open: OpenVenue, app: Hono, id: string) {
  return send(app, open.venue.cookie, "POST", "/api/sales", {
    workingOrderId: id,
    zoneId: open.counter.zoneId,
    lines: [{ menuItemId: open.counter.offerFor(open.productId), quantity: "1" }],
    tender: { method: "cash", amount: "35.00" },
  });
}

describe("while the latest record is a day after the box's clock", () => {
  let open: OpenVenue;
  let venue: BillVenue;
  let settledId = "";

  // Every case reads NOW, the latest record's time, and builds each clock from it. Only the setup
  // and the invoice of case 3 record, the second at NOW, so NOW never moves ahead of the real clock.
  useVenueDb({
    resetPerTest: false,
    migrations: MIGRATIONS,
    timeoutMs: 60_000,
    setup: async (db) => {
      open = await openVenue(db);
      venue = open.venue;
      settledId = randomUUID();
      const first = await cashSale(open, venue.app, settledId);
      if (first.status !== 200) throw new Error(`setup sale answered ${first.status}`);
    },
  });

  const nowMs = () => latest(venue.db)!.at.getTime();
  const records = () => count(venue.db, "registros_facturacion");

  /** A cash sale on the case's clock is refused and writes nothing, so the stop is in force. */
  async function expectSaleStopped(ms: number): Promise<void> {
    const record = latest(venue.db)!;
    const before = records();
    const id = randomUUID();

    const refused = await cashSale(open, venue.appAt(clockAt(ms)), id);

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual({
      code: "clock.behind_chain",
      params: {
        clockAt: new Date(ms).toISOString(),
        offsetMinutes: 60,
        lastRecordAt: record.at.toISOString(),
        lastRecordOffsetMinutes: record.offsetMinutes,
      },
    });
    expect(count(venue.db, "working_orders", sql`id = ${id}`)).toBe(0);
    expect(records()).toBe(before);
  }

  it("seats a table, saves a draft and sends it to the kitchen on a bill with no payments", async () => {
    const behind = nowMs() - DAY;
    const app = venue.appAt(clockAt(behind));
    await expectSaleStopped(behind);
    const before = records();
    const { id: tableId } = await inTx(venue, (tx) =>
      createTable(tx, venue.cfg, {
        label: `Table ${randomUUID().slice(0, 8)}`,
        zoneId: venue.zoneId,
      }),
    );

    const seated = await send(app, venue.cookie, "POST", `/api/tables/${tableId}/seat`, {});
    expect(seated.status).toBe(200);
    const partyId = seated.json.partyId as string;
    const tabId = seated.json.tabId as string;

    const saved = await send(app, venue.cookie, "PUT", `/api/parties/${partyId}/drafts`, {
      billId: tabId,
      draftId: null,
      revision: 0,
      personId: venue.operatorId,
      lines: [{ menuItemId: venue.offerFor("Paella"), quantity: "1" }],
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, tabId)),
    });
    expect(saved.status).toBe(200);
    const draft = saved.json.draft as { id: string; revision: number; lines: { id: string }[] };
    const tickets = count(venue.db, "ticket_items", sql`working_order_id = ${tabId}`);

    const sent = await send(
      app,
      venue.cookie,
      "POST",
      `/api/parties/${partyId}/drafts/${draft.id}/submit`,
      {
        submissionId: randomUUID(),
        draftRevision: draft.revision,
        expectedPartyRevision: await partyRevisionOf(venue, tabId),
        allergy: { party: { answer: "none", guests: [] }, ticks: [] },
        groups: [{ lineIds: draft.lines.map((line) => line.id), release: "fire" }],
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, tabId)),
      },
    );

    expect(sent.status).toBe(200);
    expect(count(venue.db, "ticket_items", sql`working_order_id = ${tabId}`)).toBeGreaterThan(
      tickets,
    );
    expect(count(venue.db, "bill_payments", sql`working_order_id = ${tabId}`)).toBe(0);
    expect(records()).toBe(before);
  });

  it("clocks a person in and out at the box's clock", async () => {
    const behind = nowMs() - DAY;
    await expectSaleStopped(behind);
    const clock = (path: "in" | "out", ms: number, expectedEntryId: string | null) =>
      send(
        venue.appWith({ clock: clockAt(ms), workforceEnabled: true }),
        venue.cookie,
        "POST",
        `/api/clock/${path}`,
        { expectedEntryId },
      );

    const clockedIn = await clock("in", behind, null);
    expect(clockedIn.status).toBe(200);
    const clockedOut = await clock("out", behind + MINUTE, clockedIn.json.lastEntryId as string);
    expect(clockedOut.status).toBe(200);

    const events = venue.db.all<{ kind: string; at: string }>(sql`
      select entry_kind as kind, event_at as at from time_entries
      where person_id = ${venue.operatorId}
      order by event_at
    `);
    expect(events.map((event) => [event.kind, new Date(event.at).getTime()])).toEqual([
      ["in", behind],
      ["out", behind + MINUTE],
    ]);
  });

  it("prints the original of an unpaid invoice filed before the stop, and reprints a receipt", async () => {
    const issuedAt = clockAt(nowMs());
    const billId = randomUUID();
    const deps = { db: venue.db, backend: venue.backend, clock: issuedAt };
    await parkOrder(deps, venue.cfg, {
      id: billId,
      lines: [{ menuItemId: open.counter.offerFor(open.productId), quantity: "1" }],
      zoneId: open.counter.zoneId,
      operatorId: venue.operatorId,
    });
    await issueOrderInvoice(
      { ...deps, admission: testTradingAdmission() },
      venue.cfg,
      billId,
      venue.operatorId,
    );
    await placeOrder(
      { ...deps, admission: testTradingAdmission() },
      venue.cfg,
      billId,
      venue.operatorId,
    );
    const behind = nowMs() - DAY;
    const app = venue.appAt(clockAt(behind));
    await expectSaleStopped(behind);
    const before = records();
    const jobs = count(venue.db, "print_jobs");

    const original = await send(app, venue.cookie, "POST", `/api/sales/${billId}/receipt`, {});
    expect(original.status).toBe(200);
    expect(count(venue.db, "print_jobs")).toBe(jobs + 1);

    const reprinted = await send(app, venue.cookie, "POST", `/api/sales/${settledId}/reprint`, {});
    expect(reprinted.status).toBe(200);
    expect(count(venue.db, "print_jobs")).toBe(jobs + 2);
    expect(records()).toBe(before);
    expect(registroCount(venue, billId)).toBe(1);
  });
});

describe("a venue database with no records", () => {
  let open: OpenVenue;

  // Its only sale is written on a clock a year behind the real one, so it has a database of its own.
  useVenueDb({
    migrations: MIGRATIONS,
    timeoutMs: 60_000,
    setup: async (db) => {
      open = await openVenue(db);
    },
  });

  it("takes a cash sale on a clock a year behind today", async () => {
    expect(latest(open.venue.db)).toBeUndefined();
    const yearBehind = Date.now() - 365 * DAY;
    const id = randomUUID();

    const sold = await cashSale(open, open.venue.appAt(clockAt(yearBehind)), id);

    expect(sold.status).toBe(200);
    expect(registroCount(open.venue, id)).toBe(1);
    expect(latest(open.venue.db)!.at.getTime()).toBe(Math.floor(yearBehind / 1000) * 1000);
  });
});

describe("a restored database whose only record is on another node's chain", () => {
  let open: OpenVenue;
  let recordAt: Date;

  // The record is dated T, the fixture's issue instant; every sale here is on a clock built from it.
  useVenueDb({
    migrations: MIGRATIONS,
    timeoutMs: 60_000,
    setup: async (db) => {
      open = await openVenue(db);
      const nodeId = await seedNode(db);
      const seriesId = randomUUID();
      await db.insert(invoiceSeries).values({ id: seriesId, nodeId, code: "A" });
      const other = await seedFiscalRegistro(db, {
        ids: { locationId: open.venue.cfg.locationId, nodeId, seriesId },
        reuseExistingParents: true,
      });
      expect(other.nodeId).not.toBe(open.venue.cfg.nodeId);
      recordAt = latest(db)!.at;
    },
  });

  it("refuses a cash sale a day before that record, and takes one a minute inside it", async () => {
    const { venue } = open;
    const ownChain = () =>
      count(venue.db, "registros_facturacion", sql`node_id = ${venue.cfg.nodeId}`);
    expect(ownChain()).toBe(0);
    const behind = recordAt.getTime() - DAY;
    const refusedId = randomUUID();

    const refused = await cashSale(open, venue.appAt(clockAt(behind)), refusedId);

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual({
      code: "clock.behind_chain",
      params: {
        clockAt: new Date(behind).toISOString(),
        offsetMinutes: 60,
        lastRecordAt: recordAt.toISOString(),
        lastRecordOffsetMinutes: 60,
      },
    });
    expect(count(venue.db, "working_orders", sql`id = ${refusedId}`)).toBe(0);
    expect(ownChain()).toBe(0);

    const inside = recordAt.getTime() - MINUTE + 1000;
    const sold = await cashSale(open, venue.appAt(clockAt(inside)), randomUUID());

    expect(sold.status).toBe(200);
    expect(ownChain()).toBe(1);
  });
});
