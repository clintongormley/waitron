import { Hono } from "hono";
import { and, asc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  floorTodayJoinTables,
  floorTodayJoins,
  floorTodaySplitParts,
  floorTodayTables,
  parties,
  partyTableLabels,
  partyTables,
  workingOrders,
} from "@waitron/db";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { partyTablesName } from "@waitron/shared";
import { writeClearingWorkflow } from "@waitron/venue-service";
import { foodOnItsWay } from "./delivery-release.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import {
  activeTablesOf,
  counterOrder,
  inTx,
  order,
  partyAt,
  pay,
  revisionOf,
  seat,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import { giveKeptSize, plannedZone, todayRow } from "./testing/floor-today-venue.js";
import { seedSessionDevice } from "./testing/session-device.js";
import "./errors.js";

let v: PartyVenue;
let app: Hono;
let cookie: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
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

const NOW = new Date("2026-10-10T12:00:00Z");

/** Long table (10 seats, 6 × 2 at 10, 20) = Counter 3 (2 seats), 4 (6) and 5 (4), each kept 2 × 2; Bar (4 seats, 2 × 2 at 40, 0). */
async function LONG_TABLE() {
  const zone = await plannedZone(
    v,
    [
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
    ],
    NOW,
  );
  for (const key of ["c3", "c4", "c5"])
    await giveKeptSize(v, zone.master[key]!, { width: 2, height: 2 });
  return zone;
}

/** The room's revision as a till's floor read shows it at `tableId`. */
async function readRevision(tableId: string): Promise<number> {
  const answer = await app.request("/api/tables/state", { headers: { cookie } });
  expect(answer.status, await answer.clone().text()).toBe(200);
  const tables = (await answer.json()) as { id: string; today: { zoneRevision: number } | null }[];
  return tables.find((t) => t.id === tableId)!.today!.zoneRevision;
}

/** The party at the path joins `tableId`, `moving` touching `target` on `side`, sending the revision a floor read shows. */
async function joinMerging(
  partyId: string,
  args: {
    tableId: string;
    moving: string;
    target: string;
    side: "left" | "right";
    bills?: "merge" | "separate";
    otherPartyId?: string;
  },
): Promise<Response> {
  const other =
    args.otherPartyId === undefined
      ? { otherPartyId: null }
      : {
          otherPartyId: args.otherPartyId,
          expectedOtherPartyRevision: await revisionOf(v, args.otherPartyId),
        };
  const body = {
    zoneRevision: await readRevision(args.tableId),
    tableId: args.tableId,
    bills: args.bills ?? "merge",
    expectedPartyRevision: await revisionOf(v, partyId),
    ...other,
    merge: { moving: args.moving, target: args.target, side: args.side, seats: 12 },
  };
  return app.request(`/api/parties/${partyId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

async function ok(answer: Promise<Response>): Promise<void> {
  const settled = await answer;
  expect(settled.status, await settled.clone().text()).toBe(200);
}

async function labelOf(tableId: string): Promise<string> {
  return (await tableRow(v, tableId)).label;
}

async function namesOf(...tableIds: string[]): Promise<string> {
  const labels: string[] = [];
  for (const id of tableIds) labels.push(await labelOf(id));
  return labels.join(", ");
}

function noticesOn(billIds: string[]) {
  return v.db.all<{ working_order_id: string; kind: string; moved_to: string }>(
    sql`
      select working_order_id, kind, moved_to from kitchen_notices
      where working_order_id in (${sql.join(
        billIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      order by rowid`,
  );
}

async function withClearing<T>(fn: () => Promise<T>): Promise<T> {
  await inTx(v, (tx) => writeClearingWorkflow(tx, true));
  try {
    return await fn();
  } finally {
    await inTx(v, (tx) => writeClearingWorkflow(tx, false));
  }
}

async function placeOf(tableId: string) {
  const row = await todayRow(v, tableId);
  return { x: row!.x, y: row!.y };
}

async function foodOnItsWayTo(tableId: string): Promise<void> {
  const counter = await counterOrder(v, "Paella");
  await inTx(v, (tx) =>
    tx.update(workingOrders).set({ deliveryTableId: tableId }).where(eq(workingOrders.id, counter)),
  );
  await pay(v, counter, "20.00");
  const onItsWay = await inTx(v, (tx) =>
    tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(and(eq(workingOrders.id, counter), foodOnItsWay())),
  );
  expect(onItsWay).toHaveLength(1);
}

async function everything() {
  return inTx(v, async (tx) => ({
    today: await tx.select().from(floorTodayTables).orderBy(asc(floorTodayTables.id)),
    split: await tx.select().from(floorTodaySplitParts).orderBy(asc(floorTodaySplitParts.id)),
    joins: await tx.select().from(floorTodayJoins).orderBy(asc(floorTodayJoins.id)),
    joinTables: await tx
      .select()
      .from(floorTodayJoinTables)
      .orderBy(asc(floorTodayJoinTables.tableId)),
    partyTables: await tx.select().from(partyTables).orderBy(asc(partyTables.id)),
    parties: await tx
      .select({ id: parties.id, revision: parties.revision })
      .from(parties)
      .orderBy(asc(parties.id)),
  }));
}

/** Long table as above plus Window table (4 seats, 4 × 2 at 10, 40) = Counter 6 and 7 (2 seats each), kept 2 × 2; Bar and Stool (1 seat, 2 × 2 at 50, 0) free. */
async function LONG_WINDOW_STOOL() {
  const zone = await plannedZone(
    v,
    [
      { key: "c3", label: "Counter 3", seats: 2, place: null },
      { key: "c4", label: "Counter 4", seats: 6, place: null },
      { key: "c5", label: "Counter 5", seats: 4, place: null },
      { key: "c6", label: "Counter 6", seats: 2, place: null },
      { key: "c7", label: "Counter 7", seats: 2, place: null },
      {
        key: "long",
        label: "Long table",
        seats: 10,
        place: { x: 10, y: 20, width: 6, height: 2 },
        partKeys: ["c3", "c4", "c5"],
      },
      {
        key: "window",
        label: "Window table",
        seats: 4,
        place: { x: 10, y: 40, width: 4, height: 2 },
        partKeys: ["c6", "c7"],
      },
      { key: "bar", label: "Bar", seats: 4, place: { x: 40, y: 0, width: 2, height: 2 } },
      { key: "stool", label: "Stool", seats: 1, place: { x: 50, y: 0, width: 2, height: 2 } },
    ],
    NOW,
  );
  for (const key of ["c3", "c4", "c5", "c6", "c7"])
    await giveKeptSize(v, zone.master[key]!, { width: 2, height: 2 });
  return zone;
}

/** Free tables `moving` and `target` merge into a group, with no party involved. */
async function freeMerge(moving: string, target: string, side: "left" | "right") {
  const answer = await app.request(`/api/tables/${moving}/today/merge`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      zoneRevision: await readRevision(moving),
      targetId: target,
      side,
      seats: 5,
    }),
  });
  expect(answer.status, await answer.clone().text()).toBe(200);
}

describe("guests pass to a joined table's tables when it is pushed into a group", () => {
  it("guests at Long table, Bar pushed on: the party holds Bar, Counter 3, 4 and 5, Long table needs no clearing", async () => {
    await withClearing(async () => {
      const { table } = await LONG_TABLE();
      const guests = await seat(v, table.long!);

      await ok(
        joinMerging(guests.partyId, {
          tableId: table.bar!,
          moving: table.bar!,
          target: table.long!,
          side: "left",
        }),
      );

      expect(await activeTablesOf(v, guests.partyId)).toEqual([
        table.bar!,
        table.c3!,
        table.c4!,
        table.c5!,
      ]);
      expect(await partyAt(v, table.long!)).toBeNull();
      expect((await tableRow(v, table.long!)).needsClearingSince).toBeNull();
    });
  });

  it("the kitchen gets one moved notice naming the four tables", async () => {
    const { table } = await LONG_TABLE();
    const guests = await seat(v, table.long!);
    await order(v, guests.tabId, "Burger");

    await ok(
      joinMerging(guests.partyId, {
        tableId: table.bar!,
        moving: table.bar!,
        target: table.long!,
        side: "left",
      }),
    );

    expect(await noticesOn([guests.tabId])).toEqual([
      {
        working_order_id: guests.tabId,
        kind: "moved",
        moved_to: await namesOf(table.bar!, table.c3!, table.c4!, table.c5!),
      },
    ]);
  });

  it("guests at Bar, Long table dragged onto Bar", async () => {
    const { table } = await LONG_TABLE();
    const guests = await seat(v, table.bar!);

    await ok(
      joinMerging(guests.partyId, {
        tableId: table.long!,
        moving: table.long!,
        target: table.bar!,
        side: "right",
      }),
    );

    expect(await activeTablesOf(v, guests.partyId)).toEqual([
      table.bar!,
      table.c3!,
      table.c4!,
      table.c5!,
    ]);
    expect(await placeOf(table.c3!)).toEqual({ x: 42, y: 0 });
    expect(await placeOf(table.c4!)).toEqual({ x: 44, y: 0 });
    expect(await placeOf(table.c5!)).toEqual({ x: 46, y: 0 });
  });

  it("guests at Long table, Long table dragged onto free Bar", async () => {
    const { table } = await LONG_TABLE();
    const guests = await seat(v, table.long!);

    await ok(
      joinMerging(guests.partyId, {
        tableId: table.bar!,
        moving: table.long!,
        target: table.bar!,
        side: "right",
      }),
    );

    expect(await activeTablesOf(v, guests.partyId)).toEqual([
      table.bar!,
      table.c3!,
      table.c4!,
      table.c5!,
    ]);
    expect(await partyAt(v, table.long!)).toBeNull();
    expect(await placeOf(table.c3!)).toEqual({ x: 42, y: 0 });
    expect(await placeOf(table.c4!)).toEqual({ x: 44, y: 0 });
    expect(await placeOf(table.c5!)).toEqual({ x: 46, y: 0 });
  });

  it("guests at both, Bar pushed onto Long table, bills kept separate: one moved notice per bill", async () => {
    const { table } = await LONG_TABLE();
    const atLong = await seat(v, table.long!);
    const atBar = await seat(v, table.bar!);
    await order(v, atLong.tabId, "Burger");
    await order(v, atBar.tabId, "Burger");

    await ok(
      joinMerging(atLong.partyId, {
        tableId: table.bar!,
        moving: table.bar!,
        target: table.long!,
        side: "left",
        bills: "separate",
        otherPartyId: atBar.partyId,
      }),
    );

    const four = await namesOf(table.bar!, table.c3!, table.c4!, table.c5!);
    const notices = await noticesOn([atLong.tabId, atBar.tabId]);
    const byBill = (a: { working_order_id: string }, b: { working_order_id: string }) =>
      a.working_order_id.localeCompare(b.working_order_id);
    expect(notices.sort(byBill)).toEqual(
      [
        { working_order_id: atLong.tabId, kind: "moved", moved_to: four },
        { working_order_id: atBar.tabId, kind: "moved", moved_to: four },
      ].sort(byBill),
    );
  });

  it("the party's display name reads Bar, Counter 3, Counter 4, Counter 5", async () => {
    for (let round = 0; round < 10; round++) {
      const { table } = await LONG_TABLE();
      const guests = await seat(v, table.long!);

      await ok(
        joinMerging(guests.partyId, {
          tableId: table.bar!,
          moving: table.bar!,
          target: table.long!,
          side: "left",
        }),
      );

      const labels = await inTx(v, (tx) => partyTableLabels(tx, [guests.partyId]));
      expect(partyTablesName(labels.get(guests.partyId)!), `round ${round}`).toBe(
        await namesOf(table.bar!, table.c3!, table.c4!, table.c5!),
      );
    }
  });

  it("guests at Bar, Long table dragged onto Bar while a counter order is on its way to Long table, is refused", async () => {
    const { table } = await LONG_TABLE();
    const guests = await seat(v, table.bar!);
    await foodOnItsWayTo(table.long!);
    const before = await everything();

    const answer = await joinMerging(guests.partyId, {
      tableId: table.long!,
      moving: table.long!,
      target: table.bar!,
      side: "right",
    });

    expect({ status: answer.status, body: await answer.json() }).toEqual({
      status: 409,
      body: { error: { code: "table.delivery_pending", params: { tableId: table.long! } } },
    });
    expect(await everything()).toEqual(before);
  });

  it("guests with food at Long table, Long table dragged onto a Bar and Stool group: one moved notice", async () => {
    const { table } = await LONG_WINDOW_STOOL();
    await freeMerge(table.stool!, table.bar!, "right");
    const guests = await seat(v, table.long!);
    await order(v, guests.tabId, "Burger");

    await ok(
      joinMerging(guests.partyId, {
        tableId: table.bar!,
        moving: table.long!,
        target: table.bar!,
        side: "left",
      }),
    );

    // Bar and Stool's order in the party's tables varies between runs, so only the set is pinned.
    const held = await activeTablesOf(v, guests.partyId);
    expect([...held].sort()).toEqual(
      [table.bar!, table.stool!, table.c3!, table.c4!, table.c5!].sort(),
    );
    expect(await noticesOn([guests.tabId])).toEqual([
      { working_order_id: guests.tabId, kind: "moved", moved_to: await namesOf(...held) },
    ]);
  });

  it("guests with food at both, Bar pushed onto Long table, bills merged: one moved notice per bill", async () => {
    const { table } = await LONG_TABLE();
    const atLong = await seat(v, table.long!);
    const atBar = await seat(v, table.bar!);
    await order(v, atLong.tabId, "Burger");
    await order(v, atBar.tabId, "Burger");

    await ok(
      joinMerging(atLong.partyId, {
        tableId: table.bar!,
        moving: table.bar!,
        target: table.long!,
        side: "left",
        bills: "merge",
        otherPartyId: atBar.partyId,
      }),
    );

    const four = await namesOf(table.bar!, table.c3!, table.c4!, table.c5!);
    const notices = await noticesOn([atLong.tabId, atBar.tabId]);
    const byBill = (a: { working_order_id: string }, b: { working_order_id: string }) =>
      a.working_order_id.localeCompare(b.working_order_id);
    // Bar's bill merged into Long table's, so its notice is filed on the merged bill.
    expect(notices.sort(byBill)).toEqual([
      { working_order_id: atLong.tabId, kind: "moved", moved_to: four },
      { working_order_id: atLong.tabId, kind: "moved", moved_to: four },
    ]);
  });

  it("guests at both, food at Long table only, Bar pushed onto Long table, bills merged: one moved notice", async () => {
    const { table } = await LONG_TABLE();
    const atLong = await seat(v, table.long!);
    const atBar = await seat(v, table.bar!);
    await order(v, atLong.tabId, "Burger");

    await ok(
      joinMerging(atBar.partyId, {
        tableId: table.long!,
        moving: table.bar!,
        target: table.long!,
        side: "left",
        bills: "merge",
        otherPartyId: atLong.partyId,
      }),
    );

    expect(await noticesOn([atLong.tabId, atBar.tabId])).toEqual([
      {
        working_order_id: atBar.tabId,
        kind: "moved",
        moved_to: await namesOf(table.bar!, table.c3!, table.c4!, table.c5!),
      },
    ]);
  });

  it("guests at Long table, Window table pushed onto it: the party's tables read Counter 3, 4, 5, 6, 7", async () => {
    for (let round = 0; round < 10; round++) {
      const { table } = await LONG_WINDOW_STOOL();
      const guests = await seat(v, table.long!);

      await ok(
        joinMerging(guests.partyId, {
          tableId: table.window!,
          moving: table.window!,
          target: table.long!,
          side: "right",
        }),
      );

      const five = [table.c3!, table.c4!, table.c5!, table.c6!, table.c7!];
      expect(await activeTablesOf(v, guests.partyId), `round ${round}`).toEqual(five);
      const labels = await inTx(v, (tx) => partyTableLabels(tx, [guests.partyId]));
      const [first, ...rest] = await Promise.all(five.map(labelOf));
      expect(partyTablesName(labels.get(guests.partyId)!), `round ${round}`).toBe(
        [first, ...rest.map((label) => label.replace(/^Counter /, ""))].join(", "),
      );
    }
  });
});
