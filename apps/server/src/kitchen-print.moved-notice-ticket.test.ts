import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { kitchenNotices, persons, printJobs, ticketItems, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { loginWithPin } from "@waitron/identity";
import { createPrinter } from "@waitron/printing";
import { createStation } from "./kitchen.js";
import { mountTillApi } from "./till-api.js";
import { attachPrinterToStation } from "./station-printers.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { readBillEditState } from "./bill-editing.js";
import { splitLinesWithinOrder } from "./working-order.js";
import { placeGroupedRound } from "./testing/group-submit-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { seedSessionDevice, sessionCookieForTest } from "./testing/session-device.js";
import { routeProductTo } from "./testing/zone-offers.js";
import {
  OPERATOR,
  inTx,
  orderForParty,
  revisionOf,
  seatWithNoAllergies,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { partyBillEditsForTest } from "./testing/table-action-fixture.js";
import { observedBillActionBody } from "./testing/bill-action-fixture.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { printedLines } from "./testing/decode-ticket.js";
import { decimal } from "@waitron/shared";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: PartyVenue, app: Hono, cookie: string, stationId: string, printerId: string;
let time: number;
beforeEach(async () => {
  time = Date.parse("2026-10-10T12:00:00Z");
  vi.useFakeTimers({ toFake: ["Date"], now: time });
  v = await setupPartyVenue(suite.db);
  await inTx(v, async (tx) => {
    stationId = (await createStation(tx, { name: "Grill" })).id;
    printerId = (
      await createPrinter(tx, {
        name: "Grill printer",
        transport: "cloud_poll",
        pollId: randomUUID(),
      })
    ).id;
    await attachPrinterToStation(tx, { stationId, printerId });
    for (const name of ["Burger", "Flan"]) await routeProductTo(tx, v.productId(name), stationId);
  });
  app = new Hono();
  mountTillApi(
    app,
    {
      db: v.db,
      cfg: v.cfg,
      backend: v.backend,
      clock: v.clock,
      admission: testTradingAdmission(),
      tableRemovals: enabledTableRemovals(ALL_MODULES),
      secureCookies: false,
      venueLocale: v.cfg.locale,
    },
    () => {},
  );
  const deviceId = await seedSessionDevice(v.db);
  const [admin] = await v.db
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.email, "owner@example.test"));
  const session = await inTx(v, (tx) =>
    loginWithPin(tx, { deviceId, personId: admin!.id, pin: "1234" }),
  );
  cookie = await sessionCookieForTest(v.db, session.token);
});
afterEach(() => vi.useRealTimers());
function tick() {
  vi.setSystemTime((time += 1000));
}
async function post(path: string, body: unknown) {
  tick();
  const response = await app.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return JSON.parse(text) as { billId: string };
}
async function move(partyId: string, from: string, lineId: string, into: string | null) {
  const path = `/api/bills/${from}/move-dishes`;
  return post(
    path,
    await observedBillActionBody(v.db, path, {
      lineIds: [lineId],
      toBillId: into,
      expectedPartyRevision: await revisionOf(v, partyId),
    }),
  );
}
async function join(partyId: string, tableId: string) {
  await post(`/api/parties/${partyId}/join`, {
    tableId,
    otherPartyId: null,
    expectedPartyRevision: await revisionOf(v, partyId),
    expectedEdits: await inTx(v, (tx) => partyBillEditsForTest(tx, [partyId])),
  });
}
async function splitOff(partyId: string, tableId: string) {
  const before = await v.db
    .select({ payload: printJobs.payload })
    .from(printJobs)
    .where(eq(printJobs.printerId, printerId));
  await post(`/api/parties/${partyId}/split-table`, {
    tableId,
    selection: { wholeBillIds: [], loose: [] },
    expectedPartyRevision: await revisionOf(v, partyId),
    expectedEdits: [],
  });
  const after = await v.db
    .select({ payload: printJobs.payload })
    .from(printJobs)
    .where(eq(printJobs.printerId, printerId));
  return after
    .slice(before.length)
    .map(({ payload }) => printedLines(payload))
    .filter((lines) => lines.includes(`*** ${kitchenTicketWords(v.cfg.locale).moved} ***`));
}
async function lines(billId: string) {
  return v.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
}
it("two alike dishes: the moved one's slip still prints on a split", async () => {
  const first = await v.table("Table 940"),
    second = await v.table("Table 941");
  const party = await seatWithNoAllergies(v, first);
  tick();
  await orderForParty(v, party.partyId, ["Burger", "Burger"], party.tabId);
  const sent = await lines(party.tabId);
  expect(sent).toHaveLength(2);
  const other = await move(party.partyId, party.tabId, sent[1]!.id, null);
  await join(party.partyId, second);
  await move(party.partyId, other.billId, sent[1]!.id, party.tabId);
  const slips = await splitOff(party.partyId, first);
  expect(slips).toHaveLength(1);
  expect(slips[0]!.join(" ")).toContain("BURG");
});
it.each(["Burger", "Flan"])(
  "only paper names the leaving table, second dish %s",
  async (secondDish) => {
    const first = await v.table("Table 431"),
      second = await v.table("Table 432");
    const party = await seatWithNoAllergies(v, first);
    tick();
    await orderForParty(v, party.partyId, ["Burger"], party.tabId);
    await join(party.partyId, second);
    const other = await post(`/api/parties/${party.partyId}/bills`, {
      expectedPartyRevision: await revisionOf(v, party.partyId),
    });
    tick();
    await orderForParty(v, party.partyId, [secondDish], other.billId);
    await move(party.partyId, other.billId, (await lines(other.billId))[0]!.id, party.tabId);
    expect(await splitOff(party.partyId, first)).toHaveLength(1);
  },
);
it("each MOVED notice names its ticket", async () => {
  const party = await seatWithNoAllergies(v, await v.table("Table 950"));
  tick();
  await orderForParty(v, party.partyId, ["Burger"], party.tabId);
  const line = (await lines(party.tabId))[0]!;
  await move(party.partyId, party.tabId, line.id, null);
  const [ticket] = await v.db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, line.id));
  const notices = await v.db.select().from(kitchenNotices).where(eq(kitchenNotices.kind, "moved"));
  expect(notices.length).toBeGreaterThan(0);
  expect(notices.map((notice) => notice.ticketItemId)).toEqual(notices.map(() => ticket!.id));
});
it("a rerouted dish ignores its old station's MOVED paper", async () => {
  const first = await v.table("Table 960"),
    second = await v.table("Table 961");
  const party = await seatWithNoAllergies(v, first);
  tick();
  await orderForParty(v, party.partyId, ["Burger"], party.tabId);
  await join(party.partyId, second);
  const line = (await lines(party.tabId))[0]!;
  const other = await move(party.partyId, party.tabId, line.id, null);
  const destination = await inTx(v, async (tx) => {
    const station = await createStation(tx, { name: "Bar" });
    await attachPrinterToStation(tx, { stationId: station.id, printerId });
    return station.id;
  });
  await post(`/api/working-orders/${other.billId}/lines/move-station`, {
    submissionId: randomUUID(),
    lineIds: [line.id],
    stationId: destination,
    expectedEdit: await inTx(v, (tx) => readBillEditState(tx, other.billId)),
  });
  expect(await splitOff(party.partyId, first)).toHaveLength(1);
});
it("a split piece without its own MOVED record gets the redundant slip", async () => {
  const first = await v.table("Table 970"),
    second = await v.table("Table 971");
  const party = await seatWithNoAllergies(v, first);
  tick();
  await inTx(v, (tx) =>
    placeGroupedRound(
      tx,
      v.cfg,
      party,
      { release: "fire", lines: [{ menuItemId: v.item("Burger"), quantity: "2" }] },
      OPERATOR,
    ),
  );
  const line = (await lines(party.tabId))[0]!;
  expect(line.quantity).toBe(2000);
  await join(party.partyId, second);
  const other = await move(party.partyId, party.tabId, line.id, null);
  const moved = (await lines(other.billId))[0]!;
  expect(moved.quantity).toBe(2000);
  await inTx(v, (tx) =>
    splitLinesWithinOrder(tx, v.cfg, other.billId, [
      { lineNo: moved.lineNo, quantity: decimal("1") },
    ]),
  );
  expect(await splitOff(party.partyId, first)).toHaveLength(1);
});
