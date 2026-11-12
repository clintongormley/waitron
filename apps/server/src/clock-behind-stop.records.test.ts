import { cancelItemHttp, cancelItemRequest } from "./testing/cancel-line.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { TrustedClock } from "@waitron/fiscal";
import { createPinThrottle } from "@waitron/identity";
import { deviceId as brandDeviceId, quoteLiteral } from "@waitron/shared";
import type { Draft } from "./order-drafts.js";
import { readBillEditState } from "./bill-editing.js";
import { createAdjustmentReason } from "@waitron/adjustments";
import { REASONS } from "./testing/adjustment-venue.js";
import { cancelReasonId } from "./testing/cancel-line.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { advanceTicketItem } from "./working-order.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { heldRow } from "./testing/held-row.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  groupedTabWith,
  inTx,
  partyRevisionOf,
  placedCounterBillMovedTo,
  provisionBillVenue,
  fiscalRecordCount,
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
let counterZone: string;
let counterOffer: (name: string) => string;

const ADMIN_PIN = "1234";
const REASON = "Left without paying";

// Every case reads NOW, the latest record's time, and builds each clock from it. A case records
// before its request only at NOW, and a control records a minute inside NOW, so NOW never moves.
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
    order by fecha_hora_huso_gen_registro desc, id desc
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

async function freshDraft(now: number) {
  const party = await seatedWith(venueAt(now));
  const saved = await send(at(now), venue.cookie, "PUT", `/api/parties/${party.partyId}/drafts`, {
    billId: party.tabId,
    draftId: null,
    revision: 0,
    expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, party.tabId)),
    lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
  });
  expect(saved.status, JSON.stringify(saved.json)).toBe(200);
  return { party, draft: (saved.json as unknown as { draft: Draft }).draft };
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

function settlingSnapshot() {
  return {
    bills: venue.db.all(sql`select * from working_orders order by id`),
    lines: venue.db.all(sql`select * from working_order_lines order by id`),
    drafts: venue.db.all(sql`select * from order_drafts order by id`),
    commands: venue.db.all(sql`select * from service_commands order by id`),
    adjustments: venue.db.all(sql`select * from adjustments order by id`),
    tickets: venue.db.all(sql`select * from ticket_items order by id`),
    sales: venue.db.all(sql`select * from sales order by id`),
    records: allRecords(),
    jobs: printJobs(),
  };
}

it.each(["discount", "cancel", "started cancel"] as const)(
  "a settling %s stops behind the chain while the earlier command still replays",
  async (kind) => {
    const productName = venue.db.get<{ name: string }>(
      sql`select name from products where unit_price = 300 order by id limit 1`,
    )!.name;
    const reasonId =
      kind === "discount"
        ? await inTx(venue, async (tx) => (await createAdjustmentReason(tx, REASONS.house)).id)
        : await inTx(venue, cancelReasonId);
    async function prepare(now: number) {
      const party = await seatedWith(venueAt(now), productName, productName);
      expect(
        (
          await send(
            at(now),
            venue.cookie,
            "POST",
            `/api/working-orders/${party.tabId}/payments`,
            cashPart("3.00"),
          )
        ).status,
      ).toBe(200);
      const [line] = venue.db.all<{ id: string }>(
        sql`select id from working_order_lines where working_order_id = ${party.tabId} order by line_no`,
      );
      if (kind === "started cancel") {
        const [item] = venue.db.all<{ id: string }>(
          sql`select id from ticket_items where working_order_line_id = ${line!.id}`,
        );
        expect(item).toBeDefined();
        await inTx(venue, (tx) => advanceTicketItem(tx, item!.id, "preparing"));
      }
      const [bill] = venue.db.all<{ revision: number }>(
        sql`select revision from working_orders where id = ${party.tabId}`,
      );
      const expectedEdit = await readBillEditState(venue.db, party.tabId);
      return kind === "discount"
        ? {
            billId: party.tabId,
            path: `/api/working-orders/${party.tabId}/adjustments`,
            body: {
              submissionId: randomUUID(),
              expectedEdit,
              expectedRevision: bill!.revision,
              lineId: line!.id,
              reasonId,
              approver: { personId: venue.adminId, pin: ADMIN_PIN },
              note: null,
              action: "discount_amount",
              amount: "3.00",
            },
          }
        : {
            billId: party.tabId,
            path: `/api/parties/${party.partyId}/lines/${line!.id}/cancel-item`,
            body: {
              submissionId: randomUUID(),
              expectedEdit,
              expectedPartyRevision: await partyRevisionOf(venue, party.tabId),
              expectedBillRevision: bill!.revision,
              expectedContext: await readCancellationContext(venue.db, party.partyId, line!.id),
              quantity: "1",
              outcome: "remove_charge",
              reasonId,
              ...(kind === "started cancel"
                ? { approver: { personId: venue.adminId, pin: ADMIN_PIN } }
                : {}),
            },
          };
    }
    const first = await prepare(nowMs());
    const answer = await send(at(nowMs()), venue.cookie, "POST", first.path, first.body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toHaveProperty("invoice.total", "3.00");
    expect(await statusOf(venue, first.billId)).toBe("settled");
    expect(fiscalRecordCount(venue, first.billId)).toBe(1);
    const second = await prepare(nowMs());
    const before = settlingSnapshot();
    const behind = nowMs() - 10 * MINUTE;
    const refused = await send(at(behind), venue.cookie, "POST", second.path, second.body);
    expect(refused.status).toBe(409);
    expect(refused.json).toEqual(behindChain(behind));
    expect(settlingSnapshot()).toEqual(before);
    expect(await send(at(behind), venue.cookie, "POST", first.path, first.body)).toEqual(answer);
    expect(settlingSnapshot()).toEqual(before);
    expect((await send(at(nowMs()), venue.cookie, "POST", second.path, second.body)).status).toBe(
      200,
    );
    expect(allRecords()).toBe(before.records + 1);
  },
);

describe("a kitchen send", () => {
  it("rolls back a settling Cancel item when its saved-answer write refuses", async () => {
    const now = nowMs();
    const party = await seatedWith(venueAt(now), "Caña", "Caña");
    const paid = await send(
      at(now),
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/payments`,
      cashPart("3.00"),
    );
    expect(paid.status).toBe(200);
    const ask = await cancelItemRequest(venue.db, party.tabId, 1);
    const before = settlingSnapshot();
    await venue.db
      .execute(sql`create trigger refuse_completed_submit before insert on service_commands
      when new.kind = 'line.cancel-item' and exists (select 1 from sales where working_order_id = ${sql.raw(quoteLiteral(party.tabId))})
      begin select raise(abort, 'completed submit probe'); end`);
    try {
      const answer = await send(at(now), venue.cookie, "POST", ask.path, ask.body);
      expect(answer.status).toBe(500);
      expect(answer.json).toMatchObject({ code: "server.internal" });
      expect(settlingSnapshot()).toEqual(before);
    } finally {
      await venue.db.execute(sql`drop trigger refuse_completed_submit`);
    }
    expect((await send(at(now), venue.cookie, "POST", ask.path, ask.body)).status).toBe(200);
    expect(allRecords()).toBe(before.records + 1);
  });

  it("sends a fresh draft on a bill with no payments", async () => {
    const now = nowMs();
    const { party, draft } = await freshDraft(now);
    const tickets = ticketItemsOf(party.tabId);

    const answer = await submit(at(now - 10 * MINUTE), party.partyId, party.tabId, draft);

    expect(answer.status).toBe(200);
    expect(ticketItemsOf(party.tabId)).toBeGreaterThan(tickets);
    expect(fiscalRecordCount(venue, party.tabId)).toBe(0);
  });
});

describe("a partial Cancel item", () => {
  function lineQuantity(billId: string): string {
    const [row] = venue.db.all<{ quantity: number }>(
      sql`select quantity from working_order_lines where working_order_id = ${billId} and line_no = 1`,
    );
    return String(row!.quantity);
  }

  async function setQuantity(app: Hono, billId: string, quantity: string) {
    if (quantity === "1") return cancelItemHttp(venue.db, app, venue.cookie, billId, 1, "1");
    const [row] = venue.db.all<{ revision: number }>(
      sql`select revision from working_orders where id = ${billId}`,
    );
    return send(app, venue.cookie, "PUT", `/api/working-orders/${billId}/lines/1`, {
      portionLineNos: [],
      revision: row!.revision,
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
      quantity,
    });
  }

  /**
   * A bill of two beers with one of them paid, so cutting the line to one completes it. Grouped, as
   * a bill written before portions holds it: the case cuts part of a line in place.
   */
  async function halfPaidBeers(now: number): Promise<string> {
    const billId = await groupedTabWith(venue, "Caña");
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

  it("refuses a partial Cancel item that would complete a part-paid bill", async () => {
    const now = nowMs();
    const billId = await halfPaidBeers(now);
    const before = lineQuantity(billId);
    const behind = now - 10 * MINUTE;

    const answer = await setQuantity(at(behind), billId, "1");

    expect(answer.status).toBe(409);
    expect(answer.json).toEqual(behindChain(behind));
    expect(lineQuantity(billId)).toBe(before);
    expect(fiscalRecordCount(venue, billId)).toBe(0);
  });

  it("takes the same edit a minute inside the last record", async () => {
    const now = nowMs();
    const billId = await halfPaidBeers(now);

    const answer = await setQuantity(at(now - INSIDE), billId, "1");

    expect(answer.status).toBe(200);
    expect(fiscalRecordCount(venue, billId)).toBe(1);
  });
});

describe("a held-order save", () => {
  function dishLines(billId: string) {
    return venue.db.all<{ id: string; quantity: number }>(sql`
      select id, quantity from working_order_lines
      where working_order_id = ${billId} and parent_line_id is null order by line_no`);
  }

  function revisionOf(billId: string): number {
    const [row] = venue.db.all<{ revision: number }>(
      sql`select revision from working_orders where id = ${billId}`,
    );
    return row!.revision;
  }

  /** A bill of two beers, raised as the line route raises a beer, with 3.00 of it received. */
  async function halfPaidBeers(now: number): Promise<string> {
    const billId = await tabWith(venue, "Caña");
    const raised = await send(
      at(now),
      venue.cookie,
      "PUT",
      `/api/working-orders/${billId}/lines/1`,
      {
        portionLineNos: [],
        revision: revisionOf(billId),
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
        quantity: "2",
      },
    );
    expect(raised.status).toBe(200);
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

  /** Save the bill keeping one of its two beers, which completes it. */
  async function keepOneBeer(app: Hono, billId: string) {
    return send(app, venue.cookie, "PUT", `/api/working-orders/${billId}`, {
      revision: revisionOf(billId),
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
      lines: heldRow(
        dishLines(billId).map((line) => line.id),
        "1",
        { menuItemId: venue.offerFor("Caña") },
      ),
    });
  }

  it("refuses a save that would complete a part-paid bill, and writes nothing", async () => {
    const now = nowMs();
    const billId = await halfPaidBeers(now);
    const before = dishLines(billId);
    const behind = now - 10 * MINUTE;

    const answer = await keepOneBeer(at(behind), billId);

    expect(answer.status).toBe(409);
    expect(answer.json).toEqual(behindChain(behind));
    expect(dishLines(billId)).toEqual(before);
    expect(before.reduce((sum, line) => sum + line.quantity, 0)).toBe(2000);
    expect(fiscalRecordCount(venue, billId)).toBe(0);
  });

  it("takes the same save a minute inside the last record", async () => {
    const now = nowMs();
    const billId = await halfPaidBeers(now);

    const answer = await keepOneBeer(at(now - INSIDE), billId);

    expect(answer.status).toBe(200);
    expect(dishLines(billId).map((line) => line.quantity)).toEqual([1000]);
    expect(fiscalRecordCount(venue, billId)).toBe(1);
  });
});

describe("an unpaid departure", () => {
  function depart(app: Hono, partyId: string, billId: string, pin = ADMIN_PIN) {
    return send(app, venue.cookie, "POST", `/api/parties/${partyId}/unpaid-departure`, {
      billId,
      expectedPartyRevision: revisionOfParty(partyId),
      reason: REASON,
      override: { personId: venue.adminId, pin },
    });
  }

  /** A party whose one owing bill was invoiced when it was placed at the counter. */
  async function withFiledInvoice(now: number) {
    const party = await seatedWith(venueAt(now));
    const placedId = await placedCounterBillMovedTo(venueAt(now), counterZone, party, true);
    expect(fiscalRecordCount(venue, placedId)).toBe(1);
    return { party, placedId };
  }

  it("refuses an unpaid departure of an open bill and writes nothing", async () => {
    const now = nowMs();
    const party = await seatedWith(venueAt(now), "Red wine bottle");
    const behind = now - 10 * MINUTE;

    const answer = await depart(at(behind), party.partyId, party.tabId);

    expect(answer.status).toBe(409);
    expect(answer.json).toEqual(behindChain(behind));
    expect(partyStateOf(party.partyId)).toBe("open");
    expect(salesOf(party.tabId)).toBe(0);
    expect(fiscalRecordCount(venue, party.tabId)).toBe(0);
    expect(departureRowsOf(party.partyId)).toBe(0);
  });

  it("records the departure of an open bill a minute inside the last record", async () => {
    const now = nowMs();
    const party = await seatedWith(venueAt(now), "Red wine bottle");

    const answer = await depart(at(now - INSIDE), party.partyId, party.tabId);

    expect(answer.status).toBe(200);
    expect(fiscalRecordCount(venue, party.tabId)).toBe(1);
    expect(departureRowsOf(party.partyId)).toBe(1);
  });

  it("refuses an unpaid departure of a bill whose invoice was already filed and writes nothing", async () => {
    const now = nowMs();
    const { party, placedId } = await withFiledInvoice(now);
    const behind = now - 10 * MINUTE;
    const records = allRecords();

    const answer = await depart(at(behind), party.partyId, placedId);

    expect(answer.status).toBe(409);
    expect(answer.json).toEqual(behindChain(behind));
    expect(partyStateOf(party.partyId)).toBe("open");
    expect(salesOf(placedId)).toBe(1);
    expect(allRecords()).toBe(records);
    expect(departureRowsOf(party.partyId)).toBe(0);
  });

  it("records the departure of a bill whose invoice was already filed a minute inside, filing nothing", async () => {
    const now = nowMs();
    const { party, placedId } = await withFiledInvoice(now);
    const records = allRecords();

    const answer = await depart(at(now - INSIDE), party.partyId, placedId);

    expect(answer.status).toBe(200);
    expect(allRecords()).toBe(records);
    expect(departureRowsOf(party.partyId)).toBe(1);
    expect(partyStateOf(party.partyId)).toBe("closed");
  });

  it("counts a wrong override PIN before refusing for the clock", async () => {
    const now = nowMs();
    const party = await seatedWith(venueAt(now), "Red wine bottle");
    const behind = now - 10 * MINUTE;
    const app = new Hono();
    mountTillApi(
      app,
      {
        admission: testTradingAdmission(),
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
      const wrong = await depart(app, party.partyId, party.tabId, "0000");
      expect({ status: wrong.status, code: wrong.json.code }).toEqual({
        status: 401,
        code: "pin.invalid",
      });
    }
    const throttled = await depart(app, party.partyId, party.tabId);

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
        {
          admission: testTradingAdmission(),
          db: venue.db,
          backend: venue.backend,
          clock: clockAt(now),
        },
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
