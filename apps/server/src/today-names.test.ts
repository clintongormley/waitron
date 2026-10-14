import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { printJobs } from "@waitron/db";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { createPrinter, prepareText } from "@waitron/printing";
import { kitchenNotices } from "@waitron/venue-service";
import { createStation } from "./kitchen.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { moveBill } from "./move-bill.js";
import { listOrders } from "./orders-list.js";
import { finishTable } from "./parties.js";
import { readReceiptOrder } from "./receipt-order.js";
import { attachPrinterToStation } from "./station-printers.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import type { ExpoOrder } from "./working-order.js";
import { printedLines } from "./testing/decode-ticket.js";
import {
  billRow,
  commandFor,
  floorRow,
  inTx,
  nameParty,
  OPERATOR,
  order,
  orderForParty,
  partyRow,
  pay,
  revisionOf,
  seat,
  setupPartyVenue,
  split,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  giveKeptSize,
  plannedZone,
  withRevision,
  withZoneRevision,
} from "./testing/floor-today-venue.js";
import { seedSessionDevice } from "./testing/session-device.js";
import { routeProductTo } from "./testing/zone-offers.js";
import "./errors.js";

let v: PartyVenue;
let app: Hono;
let cookie: string;
let kitchenPrinter: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    await inTx(v, async (tx) => {
      const grill = await createStation(tx, v.cfg, { name: "Grill" });
      kitchenPrinter = (
        await createPrinter(
          tx,
          { locationId: v.cfg.locationId },
          { name: "Grill printer", transport: "cloud_poll", pollId: randomUUID() },
        )
      ).id;
      await attachPrinterToStation(tx, {
        locationId: v.cfg.locationId,
        stationId: grill.id,
        printerId: kitchenPrinter,
      });
      await routeProductTo(tx, v.cfg, v.productId("Burger"), grill.id);
    });
  },
});

beforeAll(async () => {
  app = new Hono();
  mountTillApi(
    app,
    {
      db: v.db,
      backend: v.backend,
      clock: v.clock,
      cfg: v.cfg,
      tableRemovals: enabledTableRemovals(ALL_MODULES),
      secureCookies: false,
      venueLocale: v.cfg.locale,
    },
    () => {},
  );
  const deviceId = await seedSessionDevice(v.db, v.cfg);
  const session = await inTx(v, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    return loginWithPin(tx, { deviceId, personId: person!.id, pin: "5555" });
  });
  cookie = `${SESSION_COOKIE}=${session.token}`;
});

/**
 * Long table (10 seats) = Counter 3 (2), 4 (6) and 5 (4), each kept 2 × 2; Bar (4 seats); and two
 * free tables with a place, Counter 6 (2 seats) and Table 9 (4 seats).
 */
async function LONG_TABLE() {
  const zone = await plannedZone(v, [
    { key: "c3", label: "Counter 3", seats: 2, place: null },
    { key: "c4", label: "Counter 4", seats: 6, place: null },
    { key: "c5", label: "Counter 5", seats: 4, place: null },
    {
      key: "long",
      label: "Long table",
      seats: 10,
      place: { x: 10, y: 20, width: 6, height: 2 },
      partKeys: ["c3", "c4", "c5"],
    },
    { key: "bar", label: "Bar", seats: 4, place: { x: 40, y: 0, width: 2, height: 2 } },
    { key: "c6", label: "Counter 6", seats: 2, place: { x: 60, y: 0, width: 2, height: 2 } },
    { key: "t9", label: "Table 9", seats: 4, place: { x: 70, y: 0, width: 2, height: 2 } },
  ]);
  for (const key of ["c3", "c4", "c5"])
    await giveKeptSize(v, zone.master[key]!, { width: 2, height: 2 });
  return zone;
}

const suffixed = (name: string) => `${name} ${randomUUID().slice(0, 6)}`;

async function post(path: string, body: unknown): Promise<void> {
  const answer = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  expect(answer.status, await answer.clone().text()).toBe(200);
}

/** The room's revision as a till's floor read shows it at `tableId`. */
async function readRevision(tableId: string): Promise<number> {
  const answer = await app.request("/api/tables/state", { headers: { cookie } });
  expect(answer.status, await answer.clone().text()).toBe(200);
  const tables = (await answer.json()) as { id: string; today: { zoneRevision: number } | null }[];
  return tables.find((t) => t.id === tableId)!.today!.zoneRevision;
}

/** The party joins free `moving`, pushed onto its table `target`, through the party join route. */
async function pushOnto(partyId: string, moving: string, target: string, seats: number) {
  await post(`/api/parties/${partyId}/join`, {
    zoneRevision: await readRevision(moving),
    tableId: moving,
    bills: "merge",
    expectedPartyRevision: await revisionOf(v, partyId),
    otherPartyId: null,
    merge: { moving, target, side: "left", seats },
  });
}

/** 12 guests at Long table, Bar pushed on: one group of Bar, Counter 3, 4 and 5. */
async function seatedGroup() {
  const zone = await LONG_TABLE();
  const guests = await seat(v, zone.table.long!, 12);
  await pushOnto(guests.partyId, zone.table.bar!, zone.table.long!, 14);
  return { ...zone, guests };
}

async function rename(tableId: string, name: string): Promise<void> {
  await post(`/api/tables/${tableId}/today/name`, await withRevision(v, tableId, { name }));
}

async function kitchenJobs(): Promise<string[][]> {
  const rows = await inTx(v, (tx) =>
    tx
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, kitchenPrinter)),
  );
  return rows.map((row) => printedLines(row.payload));
}

async function allJobCount(): Promise<number> {
  return (await inTx(v, (tx) => tx.select({ id: printJobs.id }).from(printJobs))).length;
}

async function noticeCount(): Promise<number> {
  return (await inTx(v, (tx) => tx.select({ id: kitchenNotices.id }).from(kitchenNotices))).length;
}

/** The kitchen jobs `act` queues. */
async function jobsFrom(act: () => Promise<unknown>): Promise<string[][]> {
  const before = (await kitchenJobs()).length;
  await act();
  return (await kitchenJobs()).slice(before);
}

const isMovedSlip = (lines: string[]) => lines.includes("*** MOVED ***");

async function labelOf(tableId: string): Promise<string> {
  return (await tableRow(v, tableId)).label;
}

describe("a group renamed for today, as the kitchen sees it", () => {
  it("a ticket sent after the rename names the group, and the rename itself prints nothing", async () => {
    const { table, guests } = await seatedGroup();
    const name = suffixed("García birthday");
    const jobsBefore = await allJobCount();
    const noticesBefore = await noticeCount();

    await rename(table.c3!, name);

    expect(await allJobCount()).toBe(jobsBefore);
    expect(await noticeCount()).toBe(noticesBefore);
    const tickets = await jobsFrom(() =>
      orderForParty(v, guests.partyId, ["Burger"], guests.tabId),
    );
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toContain(prepareText(name));
    const counter3 = prepareText(await labelOf(table.c3!));
    expect(tickets[0]!.join(" ")).not.toContain(counter3);
  });

  it("a free Counter 6 pushed onto the renamed, seated group prints no MOVED slip", async () => {
    const { table, guests } = await seatedGroup();
    await rename(table.bar!, suffixed("García birthday"));
    await orderForParty(v, guests.partyId, ["Burger"], guests.tabId);

    const printed = await jobsFrom(() => pushOnto(guests.partyId, table.c6!, table.bar!, 16));

    expect(printed.filter(isMovedSlip)).toEqual([]);
  });

  it("the same push onto an unnamed seated group prints one MOVED slip", async () => {
    const { table, guests } = await seatedGroup();
    await orderForParty(v, guests.partyId, ["Burger"], guests.tabId);

    const printed = await jobsFrom(() => pushOnto(guests.partyId, table.c6!, table.bar!, 16));

    expect(printed.filter(isMovedSlip)).toHaveLength(1);
  });

  it("the party moved from the renamed group to Table 9 prints one MOVED slip from the name to Table 9", async () => {
    const { table, guests } = await seatedGroup();
    const name = suffixed("García birthday");
    await rename(table.bar!, name);
    await orderForParty(v, guests.partyId, ["Burger"], guests.tabId);

    const expectedPartyRevision = await revisionOf(v, guests.partyId);
    const printed = await jobsFrom(() =>
      post(`/api/parties/${guests.partyId}/move`, {
        toTableId: table.t9!,
        expectedPartyRevision,
      }),
    );

    const slips = printed.filter(isMovedSlip);
    expect(slips).toHaveLength(1);
    expect(slips[0]!.join(" ")).toContain(prepareText(`${name} -> ${await labelOf(table.t9!)}`));
  });

  it("the expo board names the order by the group's name", async () => {
    const { table, guests } = await seatedGroup();
    const name = suffixed("García birthday");
    await rename(table.c4!, name);
    await orderForParty(v, guests.partyId, ["Burger"], guests.tabId);

    const answer = await app.request("/api/expo/queue", { headers: { cookie } });
    expect(answer.status, await answer.clone().text()).toBe(200);
    const board = (await answer.json()) as ExpoOrder[];

    expect(board.find((order) => order.orderId === guests.tabId)?.tableLabel).toBe(name);
  });
});

async function receiptLabel(billId: string): Promise<string | null> {
  return (await inTx(v, (tx) => readReceiptOrder(tx, v.cfg, billId))).orderLabel;
}

async function finish(partyId: string): Promise<void> {
  const sent = await commandFor(v, partyId);
  await inTx(v, (tx) => finishTable(tx, { partyId, ...sent }));
}

describe("a group renamed for today, on its bills and receipts", () => {
  it("the receipt names the group", async () => {
    const { table, guests } = await seatedGroup();
    const name = suffixed("García birthday");
    await rename(table.c4!, name);

    expect(await receiptLabel(guests.tabId)).toBe(name);
  });

  it("the receipt of a party named Ana reads Ana · the group's name", async () => {
    const { table, guests } = await seatedGroup();
    const name = suffixed("García birthday");
    await rename(table.c4!, name);
    await nameParty(v, guests.partyId, "Ana");

    expect(await receiptLabel(guests.tabId)).toBe(`Ana · ${name}`);
  });

  it("a bill paid under the name keeps it on its receipt when the group is renamed again", async () => {
    const { table, guests } = await seatedGroup();
    const name = suffixed("García birthday");
    const later = suffixed("Smith party");
    await rename(table.c4!, name);
    await order(v, guests.tabId, "Burger");
    await pay(v, guests.tabId, "12.00");

    await rename(table.c4!, later);

    expect((await floorRow(v, table.c4!)).party?.displayName).toBe(later);
    expect(await receiptLabel(guests.tabId)).toBe(name);
  });

  it("the floor names the unnamed party by the group's name", async () => {
    const { table } = await seatedGroup();
    const name = suffixed("García birthday");
    await rename(table.c5!, name);

    expect((await floorRow(v, table.bar!)).party?.displayName).toBe(name);
  });
});

describe("a group renamed for today, where saved names stay", () => {
  it("the finished party keeps every saved label it held, and the orders list finds its bill by Counter 4", async () => {
    const { table, guests } = await seatedGroup();
    await rename(table.c3!, suffixed("García birthday"));
    await order(v, guests.tabId, "Burger");
    await pay(v, guests.tabId, "12.00");

    await finish(guests.partyId);

    const saved = [
      await labelOf(table.long!),
      await labelOf(table.bar!),
      await labelOf(table.c3!),
      await labelOf(table.c4!),
      await labelOf(table.c5!),
    ];
    expect((await partyRow(v, guests.partyId)).tableNames).toEqual(saved);
    const page = await inTx(v, (tx) =>
      listOrders(tx, {
        status: "all",
        dates: "any",
        credited: false,
        limit: 200,
        scope: "all",
        table: saved[3]!,
      }),
    );
    expect(page.rows.map((row) => row.id)).toContain(guests.tabId);
  });
});

describe("a group renamed for today, in the copies bills store", () => {
  it("a bill taken to the counter is labelled by the name, and keeps it after Reset to saved plan", async () => {
    const { zoneId, table, guests } = await seatedGroup();
    const name = suffixed("García birthday");
    await rename(table.c3!, name);
    await order(v, guests.tabId, "Burger", "Vino");
    const second = await split(v, guests.partyId, guests.tabId, [2]);
    const expectedPartyRevision = await revisionOf(v, guests.partyId);
    await inTx(v, (tx) =>
      moveBill(
        tx,
        v.cfg,
        second,
        { counter: { zoneId: null } },
        { bills: "merge", operatorId: OPERATOR, expectedPartyRevision },
      ),
    );
    expect((await billRow(v, second)).label).toBe(name);

    await pay(v, guests.tabId, "12.00");
    await finish(guests.partyId);
    await post(`/api/zones/${zoneId}/today/reset`, await withZoneRevision(v, zoneId, {}));

    expect((await floorRow(v, table.bar!)).today?.joinName).toBeNull();
    expect((await billRow(v, second)).label).toBe(name);
  });

  it("a bill split off the party bill stores the name as its label", async () => {
    const { table, guests } = await seatedGroup();
    const name = suffixed("García birthday");
    await rename(table.c4!, name);
    await order(v, guests.tabId, "Burger", "Vino");

    const second = await split(v, guests.partyId, guests.tabId, [2]);

    expect((await billRow(v, second)).label).toBe(name);
  });
});
