import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { workingOrderLines } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { createPinThrottle } from "@waitron/identity";
import { deviceId as brandDeviceId } from "@waitron/shared";
import type { Draft } from "./order-drafts.js";
import { readBillEditState } from "./bill-editing.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  inTx,
  partyRevisionOf,
  placedCounterBillMovedTo,
  provisionBillVenue,
  registroCount,
  seatedWith,
  send,
  statusOf,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { mountTillApi } from "./till-api.js";
import { systemClock } from "./till-backend.js";
import "./errors.js";

let venue: BillVenue;
/** A counter zone whose orders are invoiced before they are paid. */
let counterZone: string;
let counterOffer: (name: string) => string;

const ADMIN_PIN = "1234";
const REASON = "Left without paying";

// Every case reads NOW, the latest record's time, and builds each clock from it. Only the setup
// and the controls record, and a control records a minute inside NOW, so NOW never moves.
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    const offers = await inTx(venue, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
    );
    counterZone = offers.zoneId;
    const productIds = new Map(
      db
        .all<{ id: string; name: string }>(sql`select id, name from products`)
        .map((row) => [row.name, row.id]),
    );
    counterOffer = (name) => offers.offerFor(productIds.get(name)!);
    const billId = await tabWith(venue, "Paella");
    const settled = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      cashPart("35.00"),
    );
    if (settled.status !== 200) throw new Error(`setup sale answered ${settled.status}`);
  },
});

const MINUTE = 60_000;
const INSIDE = 59_000;

function latest(): { at: Date; offsetMinutes: number } {
  const [row] = venue.db.all<{ at: string; offsetMinutes: number }>(sql`
    select fecha_hora_huso_gen_registro as at, offset_minutos as offsetMinutes
    from registros_facturacion
    order by fecha_hora_huso_gen_registro desc
    limit 1
  `);
  return { at: new Date(row!.at), offsetMinutes: row!.offsetMinutes };
}

const nowMs = () => latest().at.getTime();

function clockAt(ms: number): TrustedClock {
  const base = systemClock();
  const reading = { ...base.now(), instant: new Date(ms), offsetMinutes: 60 };
  return { ...base, now: () => reading };
}

const at = (ms: number) => venue.appAt(clockAt(ms));

/** The venue as the shared helpers see it, writing on a clock at `ms`. */
function venueAt(ms: number): BillVenue {
  const clock = clockAt(ms);
  return { ...venue, clock, app: venue.appAt(clock) };
}

function behindChain(clockMs: number) {
  const record = latest();
  return {
    code: "clock.behind_chain",
    params: {
      clockAt: new Date(clockMs).toISOString(),
      offsetMinutes: 60,
      lastRecordAt: record.at.toISOString(),
      lastRecordOffsetMinutes: record.offsetMinutes,
    },
  };
}

function cashPart(amount: string) {
  return {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "cash",
    tendered: amount,
    applied: amount,
    tip: "0.00",
  };
}

function count(table: string, where = sql`1 = 1`): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(table)} where ${where}`,
  );
  return row!.n;
}

const allRecords = () => count("registros_facturacion");
const salesOf = (billId: string) => count("sales", sql`working_order_id = ${billId}`);
const ticketItemsOf = (billId: string) => count("ticket_items", sql`working_order_id = ${billId}`);
const printJobs = () => count("print_jobs");
const draftRows = (draftId: string) => count("order_drafts", sql`id = ${draftId}`);
const departureRowsOf = (partyId: string) => count("unpaid_departures", sql`party_id = ${partyId}`);

function partyStateOf(partyId: string): string {
  const [row] = venue.db.all<{ state: string }>(
    sql`select state from parties where id = ${partyId}`,
  );
  return row!.state;
}

function revisionOfParty(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

/**
 * A seated party's Tarta recalled into a draft. With `paid`, 5.00 is paid on the bill first and the
 * line is repriced to 5.00, so submitting the draft leaves the bill fully paid.
 */
async function recalledDraft(now: number, paid: boolean) {
  const party = await seatedWith(venueAt(now), "Tarta");
  if (paid) {
    const payment = await send(
      at(now),
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/payments`,
      cashPart("5.00"),
    );
    expect(payment.status).toBe(200);
  }
  const [line] = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, party.tabId));
  const recalled = await send(
    at(now),
    venue.cookie,
    "POST",
    `/api/parties/${party.partyId}/lines/${line!.id}/recall`,
    {
      submissionId: randomUUID(),
      expectedPartyRevision: await partyRevisionOf(venue, party.tabId),
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, party.tabId)),
    },
  );
  expect(recalled.status).toBe(200);
  if (paid) {
    await venue.db
      .update(workingOrderLines)
      .set({ unitPriceGross: 500 })
      .where(eq(workingOrderLines.id, line!.id));
  }
  return { party, draft: (recalled.json as unknown as { draft: Draft }).draft };
}

async function submit(app: Hono, partyId: string, tabId: string, draft: Draft) {
  return send(app, venue.cookie, "POST", `/api/parties/${partyId}/drafts/${draft.id}/submit`, {
    submissionId: randomUUID(),
    expectedPartyRevision: await partyRevisionOf(venue, tabId),
    draftRevision: draft.revision,
    groups: [{ lineIds: [draft.lines[0]!.id], release: "fire" }],
    expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, tabId)),
  });
}

describe("a kitchen send", () => {
  it("refuses a kitchen send that would complete a part-paid bill, as a whole", async () => {
    const now = nowMs();
    const { party, draft } = await recalledDraft(now, true);
    const behind = now - 10 * MINUTE;
    const tickets = ticketItemsOf(party.tabId);
    const jobs = printJobs();

    const answer = await submit(at(behind), party.partyId, party.tabId, draft);

    expect(answer.status).toBe(409);
    expect(answer.json).toEqual(behindChain(behind));
    expect(draftRows(draft.id)).toBe(1);
    expect(ticketItemsOf(party.tabId)).toBe(tickets);
    expect(printJobs()).toBe(jobs);
    expect(salesOf(party.tabId)).toBe(0);
    expect(registroCount(venue, party.tabId)).toBe(0);
  });

  it("sends a draft completing a part-paid bill a minute inside the last record", async () => {
    const now = nowMs();
    const { party, draft } = await recalledDraft(now, true);

    const answer = await submit(at(now - INSIDE), party.partyId, party.tabId, draft);

    expect(answer.status).toBe(200);
    expect(await statusOf(venue, party.tabId)).toBe("settled");
    expect(registroCount(venue, party.tabId)).toBe(1);
  });

  it("sends the same draft on a bill with no payments", async () => {
    const now = nowMs();
    const { party, draft } = await recalledDraft(now, false);
    const tickets = ticketItemsOf(party.tabId);

    const answer = await submit(at(now - 10 * MINUTE), party.partyId, party.tabId, draft);

    expect(answer.status).toBe(200);
    expect(ticketItemsOf(party.tabId)).toBeGreaterThan(tickets);
    expect(registroCount(venue, party.tabId)).toBe(0);
  });
});

describe("a line edit", () => {
  function lineQuantity(billId: string): string {
    const [row] = venue.db.all<{ quantity: number }>(
      sql`select quantity from working_order_lines where working_order_id = ${billId} and line_no = 1`,
    );
    return String(row!.quantity);
  }

  async function setQuantity(app: Hono, billId: string, quantity: string) {
    const [row] = venue.db.all<{ revision: number }>(
      sql`select revision from working_orders where id = ${billId}`,
    );
    return send(app, venue.cookie, "PUT", `/api/working-orders/${billId}/lines/1`, {
      revision: row!.revision,
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
      quantity,
    });
  }

  /** Two Cañas on a bill with one of them paid, so cutting the line to one completes it. */
  async function halfPaidCañas(now: number): Promise<string> {
    const billId = await tabWith(venue, "Caña");
    expect((await setQuantity(at(now), billId, "2")).status).toBe(200);
    const paid = await send(
      at(now),
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      cashPart("3.00"),
    );
    expect(paid.status).toBe(200);
    return billId;
  }

  it("refuses a line edit that would complete a part-paid bill", async () => {
    const now = nowMs();
    const billId = await halfPaidCañas(now);
    const before = lineQuantity(billId);
    const behind = now - 10 * MINUTE;

    const answer = await setQuantity(at(behind), billId, "1");

    expect(answer.status).toBe(409);
    expect(answer.json).toEqual(behindChain(behind));
    expect(lineQuantity(billId)).toBe(before);
    expect(registroCount(venue, billId)).toBe(0);
  });

  it("takes the same edit a minute inside the last record", async () => {
    const now = nowMs();
    const billId = await halfPaidCañas(now);

    const answer = await setQuantity(at(now - INSIDE), billId, "1");

    expect(answer.status).toBe(200);
    expect(registroCount(venue, billId)).toBe(1);
  });
});

describe("an unpaid departure", () => {
  function depart(app: Hono, partyId: string, pin = ADMIN_PIN) {
    return send(app, venue.cookie, "POST", `/api/parties/${partyId}/unpaid-departure`, {
      expectedPartyRevision: revisionOfParty(partyId),
      reason: REASON,
      override: { personId: venue.adminId, pin },
    });
  }

  /** A party whose one owing bill was invoiced when it was placed at the counter. */
  async function withFiledInvoice(now: number) {
    const party = await seatedWith(venueAt(now));
    const placedId = await placedCounterBillMovedTo(venueAt(now), counterZone, party, true);
    expect(registroCount(venue, placedId)).toBe(1);
    return { party, placedId };
  }

  it("refuses an unpaid departure of an open bill and writes nothing", async () => {
    const now = nowMs();
    const party = await seatedWith(venueAt(now), "Botella tinto");
    const behind = now - 10 * MINUTE;

    const answer = await depart(at(behind), party.partyId);

    expect(answer.status).toBe(409);
    expect(answer.json).toEqual(behindChain(behind));
    expect(partyStateOf(party.partyId)).toBe("open");
    expect(salesOf(party.tabId)).toBe(0);
    expect(registroCount(venue, party.tabId)).toBe(0);
    expect(departureRowsOf(party.partyId)).toBe(0);
  });

  it("records the departure of an open bill a minute inside the last record", async () => {
    const now = nowMs();
    const party = await seatedWith(venueAt(now), "Botella tinto");

    const answer = await depart(at(now - INSIDE), party.partyId);

    expect(answer.status).toBe(200);
    expect(registroCount(venue, party.tabId)).toBe(1);
    expect(departureRowsOf(party.partyId)).toBe(1);
  });

  it("refuses an unpaid departure of a bill whose invoice was already filed and writes nothing", async () => {
    const now = nowMs();
    const { party, placedId } = await withFiledInvoice(now);
    const behind = now - 10 * MINUTE;
    const records = allRecords();

    const answer = await depart(at(behind), party.partyId);

    expect(answer.status).toBe(409);
    expect(answer.json).toEqual(behindChain(behind));
    expect(partyStateOf(party.partyId)).toBe("open");
    expect(salesOf(placedId)).toBe(1);
    expect(allRecords()).toBe(records);
    expect(departureRowsOf(party.partyId)).toBe(0);
  });

  it("records the departure of a bill whose invoice was already filed a minute inside, filing nothing", async () => {
    const now = nowMs();
    const { party } = await withFiledInvoice(now);
    const records = allRecords();

    const answer = await depart(at(now - INSIDE), party.partyId);

    expect(answer.status).toBe(200);
    expect(allRecords()).toBe(records);
    expect(departureRowsOf(party.partyId)).toBe(1);
    expect(partyStateOf(party.partyId)).toBe("closed");
  });

  it("counts a wrong override PIN before refusing for the clock", async () => {
    const now = nowMs();
    const party = await seatedWith(venueAt(now), "Botella tinto");
    const behind = now - 10 * MINUTE;
    const app = new Hono();
    mountTillApi(
      app,
      {
        db: venue.db,
        backend: venue.backend,
        clock: clockAt(behind),
        cfg: venue.cfg,
        secureCookies: false,
        venueLocale: venue.cfg.locale,
        pool: venue.pool,
        pinThrottle: createPinThrottle({ now: () => 1_000_000 }),
      },
      () => {},
    );

    for (let i = 0; i < 4; i += 1) {
      const wrong = await depart(app, party.partyId, "0000");
      expect({ status: wrong.status, code: wrong.json.code }).toEqual({
        status: 401,
        code: "pin.invalid",
      });
    }
    const throttled = await depart(app, party.partyId);

    expect({ status: throttled.status, code: throttled.json.code }).toEqual({
      status: 429,
      code: "pin.throttled",
    });
    expect(departureRowsOf(party.partyId)).toBe(0);
    expect(partyStateOf(party.partyId)).toBe("open");
  });
});

describe("a cancel's credit", () => {
  /** A counter order parked and placed at `now`, its invoice filed at `now` when `issued`. */
  async function placed(now: number, issued: boolean): Promise<string> {
    const id = randomUUID();
    const parked = await send(at(now), venue.cookie, "POST", "/api/working-orders", {
      id,
      zoneId: counterZone,
      lines: [{ menuItemId: counterOffer("Caña"), quantity: "1" }],
    });
    expect(parked.status).toBe(200);
    if (issued) {
      await issueOrderInvoice(
        { db: venue.db, backend: venue.backend, clock: clockAt(now) },
        { ...venue.cfg, origin: { source: "device", deviceId: brandDeviceId(venue.deviceId) } },
        id,
        venue.operatorId,
      );
    }
    const place = await send(at(now), venue.cookie, "POST", `/api/working-orders/${id}/place`);
    expect(place.status).toBe(200);
    return id;
  }

  function cancel(app: Hono, id: string) {
    return send(app, venue.cookie, "POST", `/api/working-orders/${id}/cancel`, {
      reason: "Wrong order",
      override: { personId: venue.adminId, pin: ADMIN_PIN },
    });
  }

  it("refuses a cancel's credit of an invoiced order", async () => {
    const now = nowMs();
    const id = await placed(now, true);
    const behind = now - 10 * MINUTE;
    const records = allRecords();

    const answer = await cancel(at(behind), id);

    expect(answer.status).toBe(409);
    expect(answer.json).toEqual(behindChain(behind));
    expect(allRecords()).toBe(records);
    expect(await statusOf(venue, id)).toBe("placed");
  });

  it("credits an invoiced order a minute inside the last record", async () => {
    const now = nowMs();
    const id = await placed(now, true);
    const records = allRecords();

    const answer = await cancel(at(now - INSIDE), id);

    expect(answer.status).toBe(200);
    expect(allRecords()).toBe(records + 1);
    expect(await statusOf(venue, id)).toBe("abandoned");
  });

  it("cancels an order with no invoice", async () => {
    const now = nowMs();
    const id = await placed(now, false);
    const records = allRecords();

    const answer = await cancel(at(now - 10 * MINUTE), id);

    expect(answer.status).toBe(200);
    expect(allRecords()).toBe(records);
    expect(await statusOf(venue, id)).toBe("abandoned");
  });

  it("refuses a credit under a 2001 clock as clock.unusable", async () => {
    const id = await placed(nowMs(), true);
    const records = allRecords();

    const answer = await cancel(at(Date.parse("2001-06-01T12:00:00Z")), id);

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "clock.unusable" });
    expect(allRecords()).toBe(records);
    expect(await statusOf(venue, id)).toBe("placed");
  });
});
