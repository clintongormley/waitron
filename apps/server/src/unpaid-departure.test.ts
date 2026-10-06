import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  deviceProfiles,
  diningTables,
  floorZones,
  invoiceSeries,
  partyTables,
  parties,
  printJobs,
  saleSettlements,
  sales,
  unpaidDepartures,
  withTransaction,
} from "@waitron/db";
import { listOutstandingSales, recordCorrection } from "@waitron/core";
import type { FiscalBackend } from "@waitron/fiscal";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import { writeClearingWorkflow } from "@waitron/venue-service";
import { offerProducts } from "./testing/zone-offers.js";
import {
  inTx,
  partyRevisionOf,
  paymentRows,
  placedCounterBillMovedTo,
  provisionBillVenue,
  registroCount,
  seatedWith,
  send,
  statusOf,
  tabWith,
  type Answer,
  type BillVenue,
} from "./testing/bill-venue.js";
import { readOrderRevision, setOrderInvoiceChoice } from "./working-order.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { cancelBody, giveAway } from "./testing/cancel-line.js";
import { revokedDeviceSessionCookie, seedSessionDevice } from "./testing/session-device.js";
import "./errors.js";
import { watchDerivations, watchedOrder } from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

// Record unpaid departure (spec §8; service plan Task 17; owner's Q28 decision of 2026-10-01): an
// owing bill with no invoice yet is invoiced for its full amount and a bill already invoiced keeps
// its invoice; each invoice still owing something is left unpaid and recorded with who recorded and
// who authorised it, one owing nothing is settled, and the party closes as Finish closes it. Driven
// over HTTP against a venue that files real Veri*Factu records; every case seats its own party.
let venue: BillVenue;
let ticketThenPayZone: string;
let prepayZone: string;
let supervisorId: string;
/** The supervisor's own session on the first till's device. */
let supervisorCookie: string;
/** The staff operator's session on a device allowed every capability, with no device cookie. */
let staffSessionCookie: string;

const SUPERVISOR_PIN = "7777";
const REASON = "Se marcharon sin pagar";

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    ticketThenPayZone = (
      await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", serviceMode: "ticket_then_pay" }),
      )
    ).zoneId;
    prepayZone = await inTx(venue, async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: venue.cfg.locationId, name: "Barra prepago" })
        .returning({ id: floorZones.id });
      return (
        await offerProducts(tx, venue.cfg, { zone: { zoneId: zone!.id }, serviceMode: "prepay" })
      ).zoneId;
    });
    const session = await inTx(venue, async (tx) => {
      const [person] = await tx
        .insert(persons)
        .values({ displayName: "Sofía", pinHash: hashPin(SUPERVISOR_PIN), role: "supervisor" })
        .returning({ id: persons.id });
      supervisorId = person!.id;
      return loginWithPin(tx, {
        deviceId: venue.deviceId,
        personId: supervisorId,
        pin: SUPERVISOR_PIN,
      });
    });
    // Every station prints to the receipt printer, so a fire is seen as kitchen print jobs.
    db.run(sql`
      insert into station_printers (station_id, printer_id)
      select distinct k.id, d.receipt_printer_id from kitchen_stations k, devices d
      where d.receipt_printer_id is not null
    `);
    const [, ...device] = venue.cookie.split("; ");
    supervisorCookie = [`${SESSION_COOKIE}=${session.token}`, ...device].join("; ");
    const staffDeviceId = await seedSessionDevice(db, venue.cfg);
    // On the printer the venue's other devices print their receipts on.
    db.run(sql`
      update devices set receipt_printer_id =
        (select receipt_printer_id from devices where id = ${venue.deviceId})
      where id = ${staffDeviceId}
    `);
    const staff = await inTx(venue, (tx) =>
      loginWithPin(tx, { deviceId: staffDeviceId, personId: venue.operatorId, pin: "5555" }),
    );
    staffSessionCookie = `${SESSION_COOKIE}=${staff.token}`;
  },
});

function depart(partyId: string, body: Record<string, unknown>, cookie = supervisorCookie) {
  return send(venue.app, cookie, "POST", `/api/parties/${partyId}/unpaid-departure`, body);
}

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

function departuresOf(billId: string) {
  return inTx(venue, (tx) =>
    tx.select().from(unpaidDepartures).where(eq(unpaidDepartures.workingOrderId, billId)),
  );
}

function salesOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ id: sales.id, total: sales.total, settledAt: saleSettlements.settledAt })
      .from(sales)
      .leftJoin(saleSettlements, eq(saleSettlements.saleId, sales.id))
      .where(eq(sales.workingOrderId, billId)),
  );
}

async function partyState(partyId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ state: parties.state, closedBy: parties.closedBy })
      .from(parties)
      .where(eq(parties.id, partyId)),
  );
  return row!;
}

async function tableHeldBy(tableId: string): Promise<string | null> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ partyId: partyTables.partyId })
      .from(partyTables)
      .where(and(eq(partyTables.tableId, tableId), sql`${partyTables.leftAt} is null`)),
  );
  return row?.partyId ?? null;
}

async function needsClearingSince(tableId: string): Promise<string | null> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ since: diningTables.needsClearingSince })
      .from(diningTables)
      .where(eq(diningTables.id, tableId)),
  );
  return row!.since;
}

/** Nothing of the refused departure was written: no invoice, no record, the party still open. */
async function expectNothingWritten(
  partyId: string,
  billId: string,
  billStatus: "open" | "placed" = "open",
): Promise<void> {
  expect(registroCount(venue, billId)).toBe(0);
  expect(await departuresOf(billId)).toEqual([]);
  expect(await statusOf(venue, billId)).toBe(billStatus);
  expect((await partyState(partyId)).state).toBe("open");
}

/** Records a credit note of 2.00 base (-2.42) against the bill's invoice. */
function creditTwoEuros(billId: string): Promise<void> {
  return credit(billId, "2.00", "-2.42");
}

/** Records a credit note of `base` at 21% VAT, totalling `total`, against the bill's invoice. */
async function credit(billId: string, base: string, total: string): Promise<void> {
  const [issued] = await salesOf(billId);
  await inTx(venue, async (tx) => {
    const [series] = await tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(
        and(eq(invoiceSeries.nodeId, venue.cfg.nodeId), eq(invoiceSeries.purpose, "rectificative")),
      );
    const session = await loginWithPin(tx, {
      deviceId: venue.deviceId,
      personId: venue.adminId,
      pin: "1234",
    });
    await recordCorrection(tx, venue.backend, {
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(series!.id),
      correctsSaleId: brandSaleId(issued!.id),
      total,
      lines: [
        {
          lineNo: 1,
          name: "Descuento",
          descriptions: { [venue.cfg.locale]: "Descuento" },
          quantity: "-1",
          unitPrice: base,
          vatRate: "21.00",
          lineTotal: `-${base}`,
        },
      ],
      clock: venue.clock,
      authz: { sessionId: session.id },
    });
  });
}

function nextInvoiceNumbers(): { id: string; next: number }[] {
  return venue.db.all<{ id: string; next: number }>(
    sql`select id, next_number as next from invoice_series order by id`,
  );
}

describe("recording that a table left without paying", () => {
  it("does not issue a saved full-invoice choice while original delivery is unavailable", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    await setOrderInvoiceChoice(venue.db, venue.backend, venue.cfg, party.tabId, {
      revision: await inTx(venue, (tx) => readOrderRevision(tx, party.tabId)),
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    const before = nextInvoiceNumbers();

    const answer = await depart(party.partyId, {
      expectedPartyRevision: party.revision,
      reason: REASON,
    });

    expect(answer).toEqual({
      status: 409,
      json: { code: "sale.full_invoice_unavailable", params: {} },
    });
    expect(nextInvoiceNumbers()).toEqual(before);
    await expectNothingWritten(party.partyId, party.tabId);
  });

  it("invoices the open bill in full, leaves it unpaid, records who and why, and frees the table", async () => {
    const party = await seatedWith(venue, "Botella tinto");

    const answer = await depart(party.partyId, {
      expectedPartyRevision: party.revision,
      reason: `  ${REASON}  `,
    });

    expect(answer.status).toBe(200);
    expect(registroCount(venue, party.tabId)).toBe(1);
    const issued = await salesOf(party.tabId);
    expect(issued).toEqual([{ id: expect.any(String), total: 3000, settledAt: null }]);
    expect(await statusOf(venue, party.tabId)).toBe("placed");
    expect(await departuresOf(party.tabId)).toEqual([
      {
        id: expect.any(String),
        partyId: party.partyId,
        workingOrderId: party.tabId,
        saleId: issued[0]!.id,
        amount: 3000,
        reason: REASON,
        recordedBy: supervisorId,
        authorizedBy: supervisorId,
        source: "device",
        deviceId: venue.deviceId,
        recordedAt: expect.any(String),
      },
    ]);
    expect(answer.json).toEqual({
      state: "closed",
      departures: [
        {
          id: (await departuresOf(party.tabId))[0]!.id,
          workingOrderId: party.tabId,
          saleId: issued[0]!.id,
          invoiceNumber: expect.stringMatching(/^A/),
          amount: "30.00",
        },
      ],
    });
    expect(await partyState(party.partyId)).toEqual({ state: "closed", closedBy: supervisorId });
    expect(await tableHeldBy(party.tableId)).toBeNull();
    expect(await needsClearingSince(party.tableId)).toBeNull();
  });

  it("leaves the table needing clearing when the clearing workflow is on", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    await inTx(venue, (tx) => writeClearingWorkflow(tx, true));
    try {
      const answer = await depart(party.partyId, {
        expectedPartyRevision: party.revision,
        reason: REASON,
      });

      expect(answer.status).toBe(200);
      expect(await tableHeldBy(party.tableId)).toBeNull();
      expect(await needsClearingSince(party.tableId)).not.toBeNull();
    } finally {
      await inTx(venue, (tx) => writeClearingWorkflow(tx, false));
    }
  });

  it("writes nothing for the kitchen: no ticket item, no kitchen ticket, no print job", async () => {
    const counts = () =>
      venue.db.all<{ items: number; kitchen: number; prints: number }>(sql`
        select (select count(*) from ticket_items) as items,
               (select count(*) from kitchen_print_jobs) as kitchen,
               (select count(*) from print_jobs) as prints
      `)[0];
    const atStart = counts();
    const party = await seatedWith(venue, "Botella tinto");
    const before = counts();
    // The control: sending the dish is seen by all three counts.
    expect(before!.items).toBeGreaterThan(atStart!.items);
    expect(before!.kitchen).toBeGreaterThan(atStart!.kitchen);
    expect(before!.prints).toBeGreaterThan(atStart!.prints);

    const answer = await depart(party.partyId, {
      expectedPartyRevision: party.revision,
      reason: REASON,
    });

    expect(answer.status).toBe(200);
    expect(counts()).toEqual(before);
  });

  it("refuses a request from a session whose device has been revoked, and writes nothing", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    const revoked = await revokedDeviceSessionCookie(
      venue.db,
      venue.cfg,
      supervisorId,
      SUPERVISOR_PIN,
    );

    const answer = await depart(
      party.partyId,
      { expectedPartyRevision: party.revision, reason: REASON },
      revoked,
    );

    expect(answer).toMatchObject({ status: 401, json: { code: "device.unauthorized" } });
    await expectNothingWritten(party.partyId, party.tabId);
  });

  it("prints no receipt, and the bill's receipt can still be printed again", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    await depart(party.partyId, { expectedPartyRevision: party.revision, reason: REASON });
    const [issued] = await salesOf(party.tabId);
    const receiptsOf = () =>
      inTx(venue, (tx) => tx.select().from(printJobs).where(eq(printJobs.saleId, issued!.id)));
    expect(await receiptsOf()).toEqual([]);

    const reprinted = await send(
      venue.app,
      staffSessionCookie,
      "POST",
      `/api/sales/${party.tabId}/reprint`,
    );

    expect(reprinted.status).toBe(200);
    expect(await receiptsOf()).toHaveLength(1);
  });

  it("keeps the closed party's bills readable", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    await depart(party.partyId, { expectedPartyRevision: party.revision, reason: REASON });

    const bills = await send(venue.app, venue.cookie, "GET", `/api/parties/${party.partyId}/bills`);

    expect(bills.status).toBe(200);
    expect(bills.json).toEqual([
      expect.objectContaining({
        workingOrderId: party.tabId,
        status: "placed",
        total: "30.00",
        outstanding: "30.00",
        receiptAvailable: true,
      }),
    ]);
  });
});

describe("who may record it", () => {
  it("refuses an operator without the permission, and writes nothing", async () => {
    const party = await seatedWith(venue, "Botella tinto");

    const answer = await depart(
      party.partyId,
      { expectedPartyRevision: party.revision, reason: REASON },
      venue.cookie,
    );

    expect(answer).toMatchObject({
      status: 403,
      json: {
        code: "authorization.not_permitted",
        params: { permission: "sale.void" },
      },
    });
    await expectNothingWritten(party.partyId, party.tabId);
  });

  it("records it for an operator with a supervisor's PIN, naming the supervisor as authorising", async () => {
    const party = await seatedWith(venue, "Botella tinto");

    const answer = await depart(
      party.partyId,
      {
        expectedPartyRevision: party.revision,
        reason: REASON,
        override: { personId: supervisorId, pin: SUPERVISOR_PIN },
      },
      venue.cookie,
    );

    expect(answer.status).toBe(200);
    expect(await departuresOf(party.tabId)).toEqual([
      expect.objectContaining({ recordedBy: venue.operatorId, authorizedBy: supervisorId }),
    ]);
    expect((await partyState(party.partyId)).closedBy).toBe(venue.operatorId);
  });

  it("records it from a handheld for a person holding the permission, filing under the handheld", async () => {
    const [profile] = await inTx(venue, (tx) =>
      tx
        .insert(deviceProfiles)
        .values({ name: "Handheld", formFactor: "phone-portrait", capabilities: ["take-cash"] })
        .returning({ id: deviceProfiles.id }),
    );
    const handheld = await enrolDeviceForTest(venue.db, venue.cfg, {
      name: "Comandera",
      profileId: profile!.id,
    });
    const party = await seatedWith(venue, "Botella tinto");
    const onHandheld = await inTx(venue, (tx) =>
      loginWithPin(tx, {
        deviceId: handheld.deviceId,
        personId: supervisorId,
        pin: SUPERVISOR_PIN,
      }),
    );

    const answer = await depart(
      party.partyId,
      { expectedPartyRevision: party.revision, reason: REASON },
      `${SESSION_COOKIE}=${onHandheld.token}; ${DEVICE_COOKIE}=${handheld.deviceId}.${handheld.token}`,
    );

    expect(answer).toMatchObject({ status: 200, json: { state: "closed" } });
    expect(registroCount(venue, party.tabId)).toBe(1);
    expect(await departuresOf(party.tabId)).toEqual([
      expect.objectContaining({
        amount: 3000,
        recordedBy: supervisorId,
        authorizedBy: supervisorId,
        source: "device",
        deviceId: handheld.deviceId,
      }),
    ]);
    expect((await partyState(party.partyId)).state).toBe("closed");
  });

  it("records the departure under the device it was recorded on", async () => {
    const [profile] = await inTx(venue, (tx) =>
      tx
        .insert(deviceProfiles)
        .values({
          name: "Handheld origin",
          formFactor: "phone-portrait",
          capabilities: ["take-cash"],
        })
        .returning({ id: deviceProfiles.id }),
    );
    const handheld = await enrolDeviceForTest(venue.db, venue.cfg, {
      name: "Comandera origin",
      profileId: profile!.id,
    });
    const party = await seatedWith(venue, "Botella tinto");
    const onHandheld = await inTx(venue, (tx) =>
      loginWithPin(tx, {
        deviceId: handheld.deviceId,
        personId: supervisorId,
        pin: SUPERVISOR_PIN,
      }),
    );

    const answer = await depart(
      party.partyId,
      { expectedPartyRevision: party.revision, reason: REASON },
      `${SESSION_COOKIE}=${onHandheld.token}; ${DEVICE_COOKIE}=${handheld.deviceId}.${handheld.token}`,
    );

    expect(answer.status).toBe(200);
    const expected = [{ source: "device", device_id: handheld.deviceId }];
    expect(
      venue.db.all(
        sql`select source, device_id from unpaid_departures where working_order_id = ${party.tabId}`,
      ),
    ).toEqual(expected);
    expect(
      venue.db.all(
        sql`select source, device_id from sales where working_order_id = ${party.tabId}`,
      ),
    ).toEqual(expected);
  });

  it("refuses a wrong supervisor PIN, and writes nothing", async () => {
    const party = await seatedWith(venue, "Botella tinto");

    const answer = await depart(
      party.partyId,
      {
        expectedPartyRevision: party.revision,
        reason: REASON,
        override: { personId: supervisorId, pin: "0000" },
      },
      venue.cookie,
    );

    expect(answer).toMatchObject({ status: 401, json: { code: "pin.invalid" } });
    await expectNothingWritten(party.partyId, party.tabId);
  });

  it("lists the active holders of the permission, and no one else, by id and name only", async () => {
    const listed = await send(venue.app, venue.cookie, "GET", "/api/unpaid-departure-authorizers");

    expect(listed.status).toBe(200);
    const people = listed.json as unknown as Record<string, unknown>[];
    const ids = people.map((person) => person.personId);
    expect(ids).toEqual(expect.arrayContaining([venue.adminId, supervisorId]));
    expect(ids).not.toContain(venue.operatorId);
    for (const person of people) expect(Object.keys(person)).toEqual(["personId", "displayName"]);
  });
});

describe("a supervisor's PIN on a departure", () => {
  const anotherWriter = () => withTransaction(venue.db, (tx) => tx.execute(sql`select 1`));

  afterEach(async () => {
    await watchedOrder();
  });

  it("is checked while another writer commits, outside the write lock", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    watchDerivations(SUPERVISOR_PIN, anotherWriter, anotherWriter, anotherWriter);

    const answer = await depart(
      party.partyId,
      {
        expectedPartyRevision: party.revision,
        reason: REASON,
        override: { personId: supervisorId, pin: SUPERVISOR_PIN },
      },
      venue.cookie,
    );

    expect(answer.status).toBe(200);
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
    expect(await departuresOf(party.tabId)).toEqual([
      expect.objectContaining({ recordedBy: venue.operatorId, authorizedBy: supervisorId }),
    ]);
  });
});

describe("the reason", () => {
  it.each([
    ["missing", undefined],
    ["blank", "   "],
    ["too long", "x".repeat(501)],
    ["not text", 42],
  ])("refuses a %s reason, and writes nothing", async (_, reason) => {
    const party = await seatedWith(venue, "Botella tinto");

    const answer = await depart(party.partyId, {
      expectedPartyRevision: party.revision,
      ...(reason === undefined ? {} : { reason }),
    });

    expect(answer).toMatchObject({
      status: 400,
      json: { code: "management.request_invalid", params: { field: "reason" } },
    });
    await expectNothingWritten(party.partyId, party.tabId);
  });

  it("refuses an override that is not an object, and writes nothing", async () => {
    const party = await seatedWith(venue, "Botella tinto");

    const answer = await depart(
      party.partyId,
      { expectedPartyRevision: party.revision, reason: REASON, override: SUPERVISOR_PIN },
      venue.cookie,
    );

    expect(answer).toMatchObject({
      status: 400,
      json: { code: "management.request_invalid", params: { field: "override" } },
    });
    await expectNothingWritten(party.partyId, party.tabId);
  });

  it("takes a reason of exactly 500 characters", async () => {
    const party = await seatedWith(venue, "Botella tinto");

    const answer = await depart(party.partyId, {
      expectedPartyRevision: party.revision,
      reason: "x".repeat(500),
    });

    expect(answer.status).toBe(200);
  });
});

describe("bills already presented", () => {
  it("files no second invoice for a bill invoiced when it was placed, and records what that invoice still owes", async () => {
    const party = await seatedWith(venue, "Caña");
    const placedId = await placedCounterBillMovedTo(venue, ticketThenPayZone, party, true);
    await creditTwoEuros(placedId);
    const [invoiced] = await salesOf(placedId);

    const answer = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(answer.status).toBe(200);
    expect(registroCount(venue, placedId)).toBe(1);
    expect(await salesOf(placedId)).toEqual([invoiced]);
    expect(await departuresOf(placedId)).toEqual([
      expect.objectContaining({ saleId: invoiced!.id, amount: 1558 }),
    ]);
    expect(registroCount(venue, party.tabId)).toBe(1);
    expect(await departuresOf(party.tabId)).toEqual([expect.objectContaining({ amount: 300 })]);
  });

  it("invoices in full a bill placed without an invoice", async () => {
    const party = await seatedWith(venue, "Caña");
    const placedId = await placedCounterBillMovedTo(venue, prepayZone, party);
    expect(await salesOf(placedId)).toEqual([]);

    const answer = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(answer.status).toBe(200);
    expect(registroCount(venue, placedId)).toBe(1);
    const [invoiced] = await salesOf(placedId);
    expect(invoiced).toMatchObject({ total: 1800, settledAt: null });
    expect(await statusOf(venue, placedId)).toBe("placed");
    expect(await departuresOf(placedId)).toEqual([
      expect.objectContaining({ saleId: invoiced!.id, amount: 1800 }),
    ]);
  });
});

describe("a bill that owes nothing", () => {
  it("settles a presented bill whose credit note brought it to nothing, so no sale is left owing nothing", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    const placedId = await placedCounterBillMovedTo(venue, ticketThenPayZone, party, true);
    await credit(placedId, "14.88", "-18.00");
    const [invoiced] = await salesOf(placedId);

    const answer = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(answer.status).toBe(200);
    expect(answer.json.departures).toEqual([
      expect.objectContaining({ workingOrderId: party.tabId, amount: "30.00" }),
    ]);
    expect(await departuresOf(placedId)).toEqual([]);
    expect(await departuresOf(party.tabId)).toEqual([expect.objectContaining({ amount: 3000 })]);
    expect((await partyState(party.partyId)).state).toBe("closed");
    expect(await salesOf(placedId)).toEqual([
      { id: invoiced!.id, total: 1800, settledAt: expect.any(String) },
    ]);
    expect(await statusOf(venue, placedId)).toBe("settled");
    expect(registroCount(venue, placedId)).toBe(1);
    const outstanding = (await inTx(venue, listOutstandingSales)).map((sale) => sale.saleId);
    expect(outstanding).not.toContain(invoiced!.id);
    const [owed] = await salesOf(party.tabId);
    expect(outstanding).toContain(owed!.id);
  });

  it("invoices and settles an open bill whose every line was given away, beside a bill it records", async () => {
    const ana = await seatedWith(venue, "Caña");
    await giveAway(venue, ana.tabId, 1);
    const luis = await seatedWith(venue, "Botella tinto");
    const joined = await send(venue.app, venue.cookie, "POST", `/api/parties/${ana.partyId}/join`, {
      tableId: luis.tableId,
      bills: "separate",
      expectedPartyRevision: revisionOf(ana.partyId),
      otherPartyId: luis.partyId,
      expectedOtherPartyRevision: revisionOf(luis.partyId),
    });
    expect(joined.status).toBe(200);

    const answer = await depart(ana.partyId, {
      expectedPartyRevision: revisionOf(ana.partyId),
      reason: REASON,
    });

    expect(answer.status).toBe(200);
    expect(answer.json.departures).toEqual([
      expect.objectContaining({ workingOrderId: luis.tabId, amount: "30.00" }),
    ]);
    expect(await departuresOf(ana.tabId)).toEqual([]);
    expect(registroCount(venue, ana.tabId)).toBe(1);
    const [given] = await salesOf(ana.tabId);
    expect(given).toEqual({ id: expect.any(String), total: 0, settledAt: expect.any(String) });
    expect(await statusOf(venue, ana.tabId)).toBe("settled");
    const outstanding = (await inTx(venue, listOutstandingSales)).map((sale) => sale.saleId);
    expect(outstanding).not.toContain(given!.id);
    expect((await partyState(ana.partyId)).state).toBe("closed");
  });

  it("closes a party whose only owing bill a credit note has brought to nothing, settling it and recording no departure", async () => {
    const party = await seatedWith(venue);
    const placedId = await placedCounterBillMovedTo(venue, ticketThenPayZone, party, true);
    await credit(placedId, "14.88", "-18.00");
    const [invoiced] = await salesOf(placedId);

    const answer = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(answer).toMatchObject({ status: 200, json: { state: "closed", departures: [] } });
    expect(await departuresOf(placedId)).toEqual([]);
    expect(registroCount(venue, placedId)).toBe(1);
    expect(await salesOf(placedId)).toEqual([
      { id: invoiced!.id, total: 1800, settledAt: expect.any(String) },
    ]);
    expect(await statusOf(venue, placedId)).toBe("settled");
    expect((await partyState(party.partyId)).state).toBe("closed");
    expect(await tableHeldBy(party.tableId)).toBeNull();
  });

  it("closes a party whose only owing bill was given away in full, invoicing it at 0.00 and settling it", async () => {
    const party = await seatedWith(venue, "Caña");
    await giveAway(venue, party.tabId, 1);

    const answer = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(answer).toMatchObject({ status: 200, json: { state: "closed", departures: [] } });
    expect(await departuresOf(party.tabId)).toEqual([]);
    expect(registroCount(venue, party.tabId)).toBe(1);
    expect(await salesOf(party.tabId)).toEqual([
      { id: expect.any(String), total: 0, settledAt: expect.any(String) },
    ]);
    expect(await statusOf(venue, party.tabId)).toBe("settled");
    expect((await partyState(party.partyId)).state).toBe("closed");
    expect(await tableHeldBy(party.tableId)).toBeNull();
  });
});

describe("what the departure dialog lists for each bill (GET /api/parties/:id/bills)", () => {
  async function billsOf(partyId: string): Promise<Record<string, unknown>[]> {
    const listed = await send(venue.app, venue.cookie, "GET", `/api/parties/${partyId}/bills`);
    expect(listed.status).toBe(200);
    return listed.json as unknown as Record<string, unknown>[];
  }

  it("reads a presented bill whose credit note cancels its invoice as owing nothing, leaving its outstanding as it was", async () => {
    const party = await seatedWith(venue);
    const placedId = await placedCounterBillMovedTo(venue, ticketThenPayZone, party, true);
    await credit(placedId, "14.88", "-18.00");

    const bill = (await billsOf(party.partyId)).find((b) => b.workingOrderId === placedId);

    expect(bill).toMatchObject({ status: "placed", outstanding: "18.00", amountDue: "0.00" });
  });

  it("reads a partly credited presented bill at what its invoice still owes, the amount the departure then records", async () => {
    const party = await seatedWith(venue);
    const placedId = await placedCounterBillMovedTo(venue, ticketThenPayZone, party, true);
    await creditTwoEuros(placedId);

    const bill = (await billsOf(party.partyId)).find((b) => b.workingOrderId === placedId);
    const answer = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(bill).toMatchObject({ outstanding: "18.00", amountDue: "15.58" });
    expect(answer.status).toBe(200);
    expect(answer.json.departures).toEqual([
      expect.objectContaining({ workingOrderId: placedId, amount: "15.58" }),
    ]);
  });

  it("gives no amount due for a bill with no invoice", async () => {
    const party = await seatedWith(venue, "Caña");

    const bill = (await billsOf(party.partyId)).find((b) => b.workingOrderId === party.tabId);

    expect(bill).toMatchObject({ status: "open", outstanding: "3.00" });
    expect(bill).not.toHaveProperty("amountDue");
  });
});

describe("two departures at once, and a failure part-way", () => {
  it("records a party once when two departures of it are sent together", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    const placedId = await placedCounterBillMovedTo(venue, prepayZone, party);
    const body = { expectedPartyRevision: revisionOf(party.partyId), reason: REASON };

    const answers = await Promise.all([depart(party.partyId, body), depart(party.partyId, body)]);

    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(answers.find((answer) => answer.status === 409)!.json).toMatchObject({
      code: "party.not_open",
    });
    for (const billId of [party.tabId, placedId]) {
      expect(await salesOf(billId)).toHaveLength(1);
      expect(registroCount(venue, billId)).toBe(1);
      expect(await departuresOf(billId)).toHaveLength(1);
    }
  });

  it("keeps nothing when filing the second bill's invoice fails after the first was filed", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    const placedId = await placedCounterBillMovedTo(venue, prepayZone, party);
    let filed = 0;
    const failing = new Proxy(venue.backend, {
      get(target, property) {
        if (property === "recordSale") {
          return (...args: Parameters<FiscalBackend["recordSale"]>) => {
            filed += 1;
            if (filed === 2) throw new Error("the second invoice could not be filed");
            return target.recordSale(...args);
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? (value as () => unknown).bind(target) : value;
      },
    });
    const app = new Hono();
    mountTillApi(
      app,
      {
        db: venue.db,
        backend: failing,
        clock: venue.clock,
        cfg: venue.cfg,
        secureCookies: false,
        venueLocale: venue.cfg.locale,
        pool: venue.pool,
      },
      () => {},
    );
    const counters = nextInvoiceNumbers();

    const answer = await send(
      app,
      supervisorCookie,
      "POST",
      `/api/parties/${party.partyId}/unpaid-departure`,
      {
        expectedPartyRevision: revisionOf(party.partyId),
        reason: REASON,
      },
    );

    expect(filed).toBe(2);
    expect(answer.status).toBe(500);
    await expectNothingWritten(party.partyId, party.tabId);
    await expectNothingWritten(party.partyId, placedId, "placed");
    expect(await salesOf(party.tabId)).toEqual([]);
    expect(await salesOf(placedId)).toEqual([]);
    expect(nextInvoiceNumbers()).toEqual(counters);
  });
});

describe("a departure sent together with a payment or Finish table on the same party", () => {
  /** Starts the departure and the other request in the order `first` names, and awaits both. */
  function together(
    first: "departure" | "other",
    departure: () => Promise<Answer>,
    other: () => Promise<Answer>,
  ): Promise<[Answer, Answer]> {
    if (first === "departure") {
      const departed = departure();
      return Promise.all([departed, other()]);
    }
    const answered = other();
    return Promise.all([departure(), answered]);
  }

  function payInCash(billId: string, amount: string): Promise<Answer> {
    return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
    });
  }

  function finish(partyId: string, expectedPartyRevision: number): Promise<Answer> {
    return send(venue.app, venue.cookie, "POST", `/api/parties/${partyId}/finish`, {
      expectedPartyRevision,
    });
  }

  function departuresOfParty(partyId: string) {
    return inTx(venue, (tx) =>
      tx.select().from(unpaidDepartures).where(eq(unpaidDepartures.partyId, partyId)),
    );
  }

  /** The departure landed alone: the bill invoiced once and left unpaid, the party closed by it. */
  async function expectDepartureAlone(party: { partyId: string; tabId: string; tableId: string }) {
    expect(registroCount(venue, party.tabId)).toBe(1);
    expect(await salesOf(party.tabId)).toEqual([
      { id: expect.any(String), total: 3000, settledAt: null },
    ]);
    expect(await statusOf(venue, party.tabId)).toBe("placed");
    expect(await departuresOfParty(party.partyId)).toEqual([
      expect.objectContaining({ workingOrderId: party.tabId, amount: 3000 }),
    ]);
    expect(await partyState(party.partyId)).toEqual({ state: "closed", closedBy: supervisorId });
    expect(await tableHeldBy(party.tableId)).toBeNull();
  }

  const orders = [
    ["the departure started first", "departure"],
    ["the other request started first", "other"],
  ] as const;

  it.each(orders)(
    "lands a part payment or the departure, never both, with %s",
    async (_, first) => {
      const party = await seatedWith(venue, "Botella tinto");
      const body = { expectedPartyRevision: party.revision, reason: REASON };

      const [departed, paid] = await together(
        first,
        () => depart(party.partyId, body),
        () => payInCash(party.tabId, "5.00"),
      );

      expect([departed.status, paid.status].sort()).toEqual([200, 409]);
      if (paid.status === 200) {
        expect(departed.json).toMatchObject({
          code: "unpaid_departure.bill_holds_payment",
          params: { workingOrderId: party.tabId },
        });
        await expectNothingWritten(party.partyId, party.tabId);
        expect(await salesOf(party.tabId)).toEqual([]);
        expect(await paymentRows(venue, party.tabId)).toEqual([
          expect.objectContaining({ applied: 500, state: "received" }),
        ]);
      } else {
        expect(paid.json).toMatchObject({
          code: "working_order.not_open",
          params: { workingOrderId: party.tabId },
        });
        await expectDepartureAlone(party);
        expect(await paymentRows(venue, party.tabId)).toEqual([]);
      }
    },
  );

  it.each(orders)(
    "lands a payment in full or the departure, never both, and invoices the bill once, with %s",
    async (_, first) => {
      const party = await seatedWith(venue, "Botella tinto");
      const body = { expectedPartyRevision: party.revision, reason: REASON };

      const [departed, paid] = await together(
        first,
        () => depart(party.partyId, body),
        () => payInCash(party.tabId, "30.00"),
      );

      expect([departed.status, paid.status].sort()).toEqual([200, 409]);
      if (paid.status === 200) {
        expect(departed.json).toMatchObject({
          code: "unpaid_departure.nothing_outstanding",
          params: { partyId: party.partyId },
        });
        expect(registroCount(venue, party.tabId)).toBe(1);
        expect(await salesOf(party.tabId)).toEqual([
          { id: expect.any(String), total: 3000, settledAt: expect.any(String) },
        ]);
        expect(await statusOf(venue, party.tabId)).toBe("settled");
        expect(await departuresOfParty(party.partyId)).toEqual([]);
        expect((await partyState(party.partyId)).state).toBe("open");
        expect(await paymentRows(venue, party.tabId)).toEqual([
          expect.objectContaining({ applied: 3000, state: "received" }),
        ]);
      } else {
        expect(paid.json).toMatchObject({
          code: "working_order.not_open",
          params: { workingOrderId: party.tabId },
        });
        await expectDepartureAlone(party);
        expect(await paymentRows(venue, party.tabId)).toEqual([]);
      }
    },
  );

  it.each(orders)(
    "records an owing party once and closes it once when Finish table is sent too, with %s",
    async (_, first) => {
      const party = await seatedWith(venue, "Botella tinto");

      const [departed, finished] = await together(
        first,
        () => depart(party.partyId, { expectedPartyRevision: party.revision, reason: REASON }),
        () => finish(party.partyId, party.revision),
      );

      expect(departed.status).toBe(200);
      expect(finished.status).toBe(409);
      // Finish refuses the owing bill when it runs first, and the party the departure closed after.
      expect(["party.bill_outstanding", "party.not_open"]).toContain(finished.json.code);
      await expectDepartureAlone(party);
    },
  );

  it.each(orders)(
    "closes a party whose only bill was given away in full once when Finish table is sent too, with %s",
    async (_, first) => {
      const party = await seatedWith(venue, "Caña");
      await giveAway(venue, party.tabId, 1);
      const revision = revisionOf(party.partyId);

      const [departed, finished] = await together(
        first,
        () => depart(party.partyId, { expectedPartyRevision: revision, reason: REASON }),
        () => finish(party.partyId, revision),
      );

      expect(departed).toMatchObject({ status: 200, json: { state: "closed", departures: [] } });
      expect(finished.status).toBe(409);
      // Finish refuses the bill still open with a line when it runs first, and the closed party after.
      expect(["party.bill_outstanding", "party.not_open"]).toContain(finished.json.code);
      expect(registroCount(venue, party.tabId)).toBe(1);
      expect(await salesOf(party.tabId)).toEqual([
        { id: expect.any(String), total: 0, settledAt: expect.any(String) },
      ]);
      expect(await statusOf(venue, party.tabId)).toBe("settled");
      expect(await departuresOfParty(party.partyId)).toEqual([]);
      expect(await partyState(party.partyId)).toEqual({ state: "closed", closedBy: supervisorId });
    },
  );

  it.each(orders)(
    "lets Finish table close a party owing nothing, and records no departure, with %s",
    async (_, first) => {
      const party = await seatedWith(venue);

      const [departed, finished] = await together(
        first,
        () => depart(party.partyId, { expectedPartyRevision: party.revision, reason: REASON }),
        () => finish(party.partyId, party.revision),
      );

      expect(finished).toMatchObject({ status: 200, json: { state: "closed" } });
      expect(departed.status).toBe(409);
      // The departure refuses a party owing nothing when it runs first, and the closed party after.
      expect(["unpaid_departure.nothing_outstanding", "party.not_open"]).toContain(
        departed.json.code,
      );
      expect(await departuresOfParty(party.partyId)).toEqual([]);
      expect(registroCount(venue, party.tabId)).toBe(0);
      expect(await statusOf(venue, party.tabId)).toBe("abandoned");
      expect(await partyState(party.partyId)).toEqual({
        state: "closed",
        closedBy: venue.operatorId,
      });
      expect(await tableHeldBy(party.tableId)).toBeNull();
    },
  );
});

describe("the party's other bills", () => {
  it("abandons an empty bill, as Finish does", async () => {
    const party = await seatedWith(venue);
    const placedId = await placedCounterBillMovedTo(venue, ticketThenPayZone, party, true);

    const answer = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(answer.status).toBe(200);
    expect(await statusOf(venue, party.tabId)).toBe("abandoned");
    expect(await departuresOf(party.tabId)).toEqual([]);
    expect(await departuresOf(placedId)).toEqual([expect.objectContaining({ amount: 1800 })]);
  });
});

describe("what is refused", () => {
  it("refuses a bill holding dishes never sent to the kitchen, and writes nothing", async () => {
    const billId = await tabWith(venue, "Botella tinto");
    const [{ partyId }] = venue.db.all<{ partyId: string }>(
      sql`select party_id as partyId from working_orders where id = ${billId}`,
    ) as [{ partyId: string }];

    const answer = await depart(partyId, {
      expectedPartyRevision: await partyRevisionOf(venue, billId),
      reason: REASON,
    });

    expect(answer).toMatchObject({
      status: 409,
      json: { code: "unpaid_departure.unfired_dishes", params: { workingOrderId: billId } },
    });
    await expectNothingWritten(partyId, billId);
  });

  it("refuses a bill holding a dish whose group is still held, then records the rest once that dish is cancelled", async () => {
    const party = await seatedWith(venue);
    const ordered = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          {
            lines: [{ menuItemId: venue.offerFor("Botella tinto"), quantity: "1" }],
            release: "fire",
          },
          { lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }], release: "hold" },
        ],
      },
    );
    expect(ordered.status).toBe(200);

    const refused = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(refused).toMatchObject({
      status: 409,
      json: { code: "unpaid_departure.unfired_dishes", params: { workingOrderId: party.tabId } },
    });
    await expectNothingWritten(party.partyId, party.tabId);

    const cancelled = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/adjustments`,
      await cancelBody(venue.db, party.tabId, 2),
    );
    expect(cancelled.status).toBe(200);

    const recorded = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(recorded.status).toBe(200);
    expect(registroCount(venue, party.tabId)).toBe(1);
    expect(await salesOf(party.tabId)).toEqual([
      { id: expect.any(String), total: 3000, settledAt: null },
    ]);
    expect(await departuresOf(party.tabId)).toEqual([expect.objectContaining({ amount: 3000 })]);
  });

  it("refuses a bill holding a dish recalled from the kitchen, and writes nothing", async () => {
    const party = await seatedWith(venue, "Botella tinto", "Caña");
    const recalled = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/lines/recall`,
      { lineNos: [2] },
    );
    expect(recalled.status).toBe(200);

    const answer = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(answer).toMatchObject({
      status: 409,
      json: { code: "unpaid_departure.unfired_dishes", params: { workingOrderId: party.tabId } },
    });
    await expectNothingWritten(party.partyId, party.tabId);
  });

  it("refuses a presented bill with no invoice yet holding a dish whose group is still held, and writes nothing", async () => {
    const party = await seatedWith(venue);
    const ordered = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          {
            lines: [{ menuItemId: venue.offerFor("Botella tinto"), quantity: "1" }],
            release: "fire",
          },
          { lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }], release: "hold" },
        ],
      },
    );
    expect(ordered.status).toBe(200);
    const placed = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/place`,
    );
    expect(placed.status).toBe(200);
    expect(await statusOf(venue, party.tabId)).toBe("placed");
    expect(await salesOf(party.tabId)).toEqual([]);

    const answer = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(answer).toMatchObject({
      status: 409,
      json: { code: "unpaid_departure.unfired_dishes", params: { workingOrderId: party.tabId } },
    });
    await expectNothingWritten(party.partyId, party.tabId, "placed");
  });

  it("refuses a bill holding a payment, and writes nothing", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "5.00",
        method: "cash",
        tendered: "5.00",
        applied: "5.00",
        tip: "0.00",
      },
    );
    expect(paid.status).toBe(200);

    const answer = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(answer).toMatchObject({
      status: 409,
      json: {
        code: "unpaid_departure.bill_holds_payment",
        params: { workingOrderId: party.tabId },
      },
    });
    await expectNothingWritten(party.partyId, party.tabId);
  });

  it("refuses a bill being paid in full by card at the reader, and writes nothing", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    venue.db.run(
      sql`update working_orders set payment_attempt_at = ${new Date().toISOString()} where id = ${party.tabId}`,
    );
    try {
      const answer = await depart(party.partyId, {
        expectedPartyRevision: party.revision,
        reason: REASON,
      });

      expect(answer).toMatchObject({
        status: 409,
        json: { code: "order.payment_in_flight", params: { workingOrderId: party.tabId } },
      });
      await expectNothingWritten(party.partyId, party.tabId);
    } finally {
      venue.db.run(
        sql`update working_orders set payment_attempt_at = null where id = ${party.tabId}`,
      );
    }
  });

  it("refuses a party with nothing outstanding, which Finish table then closes", async () => {
    const party = await seatedWith(venue);

    const answer = await depart(party.partyId, {
      expectedPartyRevision: party.revision,
      reason: REASON,
    });

    expect(answer).toMatchObject({
      status: 409,
      json: { code: "unpaid_departure.nothing_outstanding", params: { partyId: party.partyId } },
    });
    expect((await partyState(party.partyId)).state).toBe("open");
    const finished = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/finish`,
      { expectedPartyRevision: revisionOf(party.partyId) },
    );
    expect(finished).toMatchObject({ status: 200, json: { state: "closed" } });
  });

  it("refuses a stale party revision as Finish does, and writes nothing", async () => {
    const party = await seatedWith(venue, "Botella tinto");

    const answer = await depart(party.partyId, {
      expectedPartyRevision: party.revision - 1,
      reason: REASON,
    });

    expect(answer).toMatchObject({
      status: 409,
      json: { code: "party.out_of_date", params: { revision: party.revision } },
    });
    await expectNothingWritten(party.partyId, party.tabId);
  });

  it("answers a retry after it was recorded as Finish does a closed party, and invoices nothing twice", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    const body = { expectedPartyRevision: party.revision, reason: REASON };
    expect((await depart(party.partyId, body)).status).toBe(200);

    const retried = await depart(party.partyId, body);

    expect(retried).toMatchObject({ status: 409, json: { code: "party.not_open" } });
    expect(registroCount(venue, party.tabId)).toBe(1);
    expect(await departuresOf(party.tabId)).toHaveLength(1);
  });
});

describe("a merged party", () => {
  it("invoices and records an owing bill brought by each party, and frees every table", async () => {
    const ana = await seatedWith(venue, "Botella tinto");
    const luis = await seatedWith(venue, "Pulpo");
    const joined = await send(venue.app, venue.cookie, "POST", `/api/parties/${ana.partyId}/join`, {
      tableId: luis.tableId,
      bills: "separate",
      expectedPartyRevision: revisionOf(ana.partyId),
      otherPartyId: luis.partyId,
      expectedOtherPartyRevision: revisionOf(luis.partyId),
    });
    expect(joined.status).toBe(200);

    const answer = await depart(ana.partyId, {
      expectedPartyRevision: revisionOf(ana.partyId),
      reason: REASON,
    });

    expect(answer.status).toBe(200);
    expect(registroCount(venue, ana.tabId)).toBe(1);
    expect(registroCount(venue, luis.tabId)).toBe(1);
    expect(await departuresOf(ana.tabId)).toEqual([expect.objectContaining({ amount: 3000 })]);
    expect(await departuresOf(luis.tabId)).toEqual([expect.objectContaining({ amount: 2000 })]);
    expect(await tableHeldBy(ana.tableId)).toBeNull();
    expect(await tableHeldBy(luis.tableId)).toBeNull();
  });
});
