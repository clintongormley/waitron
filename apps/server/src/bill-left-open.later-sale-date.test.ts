import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction } from "@waitron/db";
import { hashPin, loginWithPin } from "@waitron/identity";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import {
  cashPayment,
  provisionBillVenue,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import { cancelItemHttp, cancelReasonId } from "./testing/cancel-line.js";
import { writeGroupedLines } from "./testing/grouped-counter-order.js";
import { clockAtIso as clockAt, filedFor } from "./testing/later-sale-date-fixture.js";
import { createTable } from "./testing/live-table.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { closingEditsForTest } from "./testing/party-close-fixture.js";
import { fireAll, openPartyTab } from "./testing/serve-line.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { parkOrder } from "./working-order.js";
import { SESSION_COOKIE } from "./till-session.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// Europe/Madrid, UTC+1 in March, its business day turning over at 05:00. 16 March 2026 is a Monday.
const MON_2200 = "2026-03-16T21:00:00.000Z";
const MON_2230 = "2026-03-16T21:30:00.000Z";
const WED_0910 = "2026-03-18T08:10:00.000Z";
const WED_1100 = "2026-03-18T10:00:00.000Z";
const THU_1200 = "2026-03-19T11:00:00.000Z";

function cashSale(venue: BillVenue, at: string, billId: string, amount: string) {
  return cashPayment({ db: venue.db, app: venue.appAt(clockAt(at)) }, venue.cookie, billId, amount);
}

async function expectOneDate(venue: BillVenue, billId: string, issueDay: string) {
  expect(await statusOf(venue, billId)).toBe("settled");
  const { supplyDay, ticket, record } = await filedFor(venue, billId);
  expect(supplyDay).toBeNull();
  expect(ticket).not.toHaveProperty("saleDay");
  expect(record).toEqual({ operationDate: null, issueDate: issueDay });
}

/** Dates a bill's trusted opening at `at`, as a bill seated then. */
function openedAt(venue: BillVenue, billId: string, at: string): void {
  venue.db.run(sql`update working_orders set trusted_opened_at = ${at} where id = ${billId}`);
}

/** The bill files the calendar day Monday's business day ended on, as the close of day would. */
async function expectCloseOfDay(venue: BillVenue, billId: string, issueDay: string) {
  const { supplyDay, ticket, record } = await filedFor(venue, billId);
  expect(supplyDay).toBe("2026-03-17");
  expect(ticket.saleDay).toBe("2026-03-17");
  expect(record).toEqual({ operationDate: "2026-03-17", issueDate: issueDay });
}

function partyRevisionNow(venue: BillVenue, partyId: string): number {
  return venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  )[0]!.revision;
}

/** Marks one portion of line 1 of a party's bill served, or takes one back with `undo`, through
 * the till's route while the box's clock reads `at`. */
async function serveAt(venue: BillVenue, billId: string, at: string, { undo = false } = {}) {
  const [line] = venue.db.all<{ id: string; partyId: string; revision: number }>(sql`
    select l.id as id, o.party_id as partyId, p.revision as revision
    from working_order_lines l
    join working_orders o on o.id = l.working_order_id
    join parties p on p.id = o.party_id
    where l.working_order_id = ${billId} and l.line_no = 1`);
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(at) });
  try {
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${line!.partyId}/${undo ? "unserved" : "served"}`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: line!.revision,
        items: [{ lineId: line!.id, quantity: "1" }],
      },
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  } finally {
    vi.useRealTimers();
  }
}

describe("a bill left open past its business day is dated by its close, never by a serving mark", () => {
  it("keeps one date for a placed takeaway collected on Thursday", async () => {
    const venue = await provisionBillVenue(suite.db);
    const id = randomUUID();
    const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
    await parkOrder(deps, venue.cfg, {
      id,
      lines: [{ menuItemId: venue.offerFor("Croquettes"), quantity: "1" }],
      zoneId: venue.zoneId,
      operatorId: venue.operatorId,
    });
    await placeOrder(
      { ...deps, admission: testTradingAdmission() },
      venue.cfg,
      id,
      venue.operatorId,
    );

    const collected = await send(
      venue.appAt(clockAt(THU_1200)),
      venue.cookie,
      "POST",
      `/api/working-orders/${id}/collect`,
      { tender: { method: "cash", amount: "10.00" } },
    );

    expect(collected.status, JSON.stringify(collected.json)).toBe(200);
    await expectOneDate(venue, id, "2026-03-19");
  });

  it("files the end of Monday's business day for a Monday meal served on Monday and paid in cash on Thursday", async () => {
    const venue = await provisionBillVenue(suite.db);
    const party = await seatedWith(venue, "Croquettes");
    openedAt(venue, party.tabId, MON_2200);
    await serveAt(venue, party.tabId, MON_2230);

    const paid = await cashSale(venue, THU_1200, party.tabId, "10.00");

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await statusOf(venue, party.tabId)).toBe("settled");
    await expectCloseOfDay(venue, party.tabId, "2026-03-19");
  });

  it("files the end of Monday's business day for a Monday meal served on Monday whose unpaid departure is recorded on Thursday", async () => {
    const venue = await provisionBillVenue(suite.db);
    const party = await seatedWith(venue, "Croquettes");
    openedAt(venue, party.tabId, MON_2200);
    await serveAt(venue, party.tabId, MON_2230);
    const session = await withTransaction(venue.db, async (tx) => {
      const [person] = await seedPersons(tx, {
        displayName: "Sophia",
        pinHash: hashPin("8642"),
        role: "supervisor",
      });
      return loginWithPin(tx, { deviceId: venue.deviceId, personId: person!.id, pin: "8642" });
    });
    const [, ...device] = venue.cookie.split("; ");
    const supervisor = [`${SESSION_COOKIE}=${session.token}`, ...device].join("; ");

    const departed = await send(
      venue.appAt(clockAt(THU_1200)),
      supervisor,
      "POST",
      `/api/parties/${party.partyId}/unpaid-departure`,
      {
        billId: party.tabId,
        expectedPartyRevision: partyRevisionNow(venue, party.partyId),
        reason: "Guest left without paying",
      },
    );

    expect(departed.status, JSON.stringify(departed.json)).toBe(200);
    await expectCloseOfDay(venue, party.tabId, "2026-03-19");
  });

  it("files the end of Monday's business day for a Monday meal served on Monday whose bill is printed (Print the bill) on Thursday", async () => {
    const venue = await provisionBillVenue(suite.db);
    const party = await seatedWith(venue, "Croquettes");
    openedAt(venue, party.tabId, MON_2200);
    await serveAt(venue, party.tabId, MON_2230);
    venue.db.run(sql`
      update device_profiles
      set capabilities = json_insert(capabilities, '$[#]', 'print-receipt')
      where name = 'Counter till'
    `);

    const printed = await send(
      venue.appAt(clockAt(THU_1200)),
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/end-meal`,
      {
        billId: party.tabId,
        expectedPartyRevision: partyRevisionNow(venue, party.partyId),
        expectedEdits: await closingEditsForTest(venue.db, party.partyId),
        submissionId: randomUUID(),
      },
    );

    expect(printed.status, JSON.stringify(printed.json)).toBe(200);
    await expectCloseOfDay(venue, party.tabId, "2026-03-19");
  });

  it("files the end of Monday's business day when a later serving mark is taken back and the rest cancelled before payment", async () => {
    const venue = await provisionBillVenue(suite.db);
    const billId = await withTransaction(venue.db, async (tx) => {
      const table = await createTable(tx, venue.cfg, {
        label: `M-${randomUUID().slice(0, 8)}`,
        zoneId: venue.zoneId,
      });
      const { tabId } = await openPartyTab(tx, venue.cfg, { tableId: table.id });
      await writeGroupedLines(tx, venue.cfg, tabId, [
        { menuItemId: venue.offerFor("Croquettes"), quantity: "2" },
      ]);
      await fireAll(tx, venue.cfg, tabId);
      return tabId;
    });
    openedAt(venue, billId, MON_2200);
    await serveAt(venue, billId, MON_2200);
    await serveAt(venue, billId, WED_0910);
    await serveAt(venue, billId, WED_0910, { undo: true });
    const cancelled = await cancelItemHttp(
      venue.db,
      venue.appAt(clockAt(WED_1100)),
      venue.cookie,
      billId,
      1,
      "1",
      {
        reasonId: await withTransaction(venue.db, cancelReasonId),
        approver: { personId: venue.adminId, pin: "1234" },
      },
    );
    expect(cancelled.status, JSON.stringify(cancelled.json)).toBe(200);

    const paid = await cashSale(venue, THU_1200, billId, "10.00");

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await statusOf(venue, billId)).toBe("settled");
    await expectCloseOfDay(venue, billId, "2026-03-19");
  });
});
