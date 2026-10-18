import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { asc, sql, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  tableInService,
  diningTables,
  floorPlans,
  floorPlanSets,
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodaySplitParts,
  floorTodayTables,
  floorTodayZones,
  floorZones,
  locations,
  partyTables,
  ticketItems,
  workingOrders,
} from "@waitron/db";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import {
  createDepartment,
  createServiceZone,
  departmentFloorPlanSets,
  linkFloorPlanSet,
  menuPeriods,
  zoneServicePolicies,
} from "@waitron/venue-service";
import { readLayout, saveLayout } from "./floor-plan.js";
import { floorDeletionFor } from "./floor-delete.js";
import { resetZone } from "./floor-today-store.js";
import { placeGroups } from "./order-groups.js";
import { defaultLayout } from "./testing/floor-sets.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";

import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import {
  inTx,
  OPERATOR,
  pricedInZone,
  revisionOf,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  expectRevision,
  giveKeptSize,
  needingMoving,
  plannedZone,
  setsDepartment,
  standardAndDinner,
  tableServiceZone,
  todayRow,
  withRevision,
  withZoneRevision,
  zoneRevisionOf,
} from "./testing/floor-today-venue.js";
import { seedSessionDevice } from "./testing/session-device.js";
import "./errors.js";

let v: PartyVenue;
let app: Hono;
let cookie: string;
/** The moment the till routes read; null reads the real clock. */
let fixedAt: Date | null = null;

const REMOVALS = enabledTableRemovals(ALL_MODULES);

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
      clock: {
        ...v.clock,
        now: () => ({ ...v.clock.now(), ...(fixedAt === null ? {} : { instant: fixedAt }) }),
      },
      cfg: v.cfg,
      tableRemovals: REMOVALS,
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

afterEach(() => {
  fixedAt = null;
});

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function today(tableId: string, change: string, body: unknown = {}): Promise<Response> {
  return send(
    "POST",
    `/api/tables/${tableId}/today/${change}`,
    await withRevision(v, tableId, body),
  );
}

interface FloorToday {
  placement: { x: number; y: number; rotation: number } | null;
  seats: number | null;
  takenOff: boolean;
  zoneRevision: number;
  needsMoving: boolean;
}

async function floorToday(tableId: string): Promise<FloorToday | null> {
  const answer = await send("GET", "/api/tables/state");
  expect(answer.status).toBe(200);
  const tables = (await answer.json()) as { id: string; today: FloorToday | null }[];
  return tables.find((t) => t.id === tableId)!.today;
}

async function seatAt(tableId: string): Promise<string> {
  const answer = await send("POST", `/api/tables/${tableId}/seat`, {});
  expect(answer.status).toBe(200);
  return ((await answer.json()) as { partyId: string }).partyId;
}

async function finish(partyId: string): Promise<void> {
  const answer = await send("POST", `/api/parties/${partyId}/finish`, {
    expectedPartyRevision: await revisionOf(v, partyId),
  });
  expect(answer.status).toBe(200);
}

async function refusal(answer: Promise<Response>): Promise<{ status: number; body: unknown }> {
  const settled = await answer;
  return { status: settled.status, body: await settled.json() };
}

/** Every today's row, split row, group row and party table, to show a refusal wrote nothing. */
async function everything() {
  const today = await inTx(v, (tx) =>
    tx.select().from(floorTodayTables).orderBy(asc(floorTodayTables.id)),
  );
  const split = await inTx(v, (tx) =>
    tx.select().from(floorTodaySplitParts).orderBy(asc(floorTodaySplitParts.id)),
  );
  const joins = await inTx(v, (tx) =>
    tx.select().from(floorTodayJoins).orderBy(asc(floorTodayJoins.id)),
  );
  const joinTables = await inTx(v, (tx) =>
    tx.select().from(floorTodayJoinTables).orderBy(asc(floorTodayJoinTables.id)),
  );
  const parties = await inTx(v, (tx) => tx.select().from(partyTables).orderBy(asc(partyTables.id)));
  return { today, split, joins, joinTables, parties };
}

async function resetZoneToday(zoneId: string, body: unknown = {}): Promise<Response> {
  return send("POST", `/api/zones/${zoneId}/today/reset`, await withZoneRevision(v, zoneId, body));
}

describe("the table routes' revision", () => {
  const outOfDate = (zoneId: string, revision: number) => ({
    status: 409,
    body: { error: { code: "floor_today.out_of_date", params: { zoneId, revision } } },
  });

  /** A room of two ordinary tables and a spare. */
  const ROOM = () =>
    plannedZone(v, [
      { key: "a", place: { x: 0, y: 0 } },
      { key: "b", place: { x: 20, y: 0 } },
      { key: "spare", place: null },
    ]);

  type Setup = () => Promise<{ zoneId: string; tableId: string; body: Record<string, unknown> }>;

  const ROUTES: [string, Setup, string?][] = [
    [
      "move",
      async () => {
        const { zoneId, table } = await ROOM();
        return { zoneId, tableId: table.a!, body: { x: 30, y: 30 } };
      },
    ],
    [
      "rotate",
      async () => {
        const { zoneId, table } = await ROOM();
        return { zoneId, tableId: table.a!, body: {} };
      },
    ],
    [
      "take-off",
      async () => {
        const { zoneId, table } = await LONG();
        return { zoneId, tableId: table.bar!, body: {} };
      },
    ],
    [
      "put-back",
      async () => {
        const { zoneId, table } = await LONG();
        await expectRevision(v, today(table.bar!, "take-off"), zoneId);
        return { zoneId, tableId: table.bar!, body: {} };
      },
    ],
    [
      "place",
      async () => {
        const { zoneId, table } = await ROOM();
        return { zoneId, tableId: table.spare!, body: { x: 40, y: 40 } };
      },
    ],
    [
      "seats",
      async () => {
        const { zoneId, table } = await ROOM();
        return { zoneId, tableId: table.a!, body: { seats: 5 } };
      },
    ],
    [
      "back",
      async () => {
        const { zoneId, table } = await ROOM();
        await expectRevision(v, today(table.a!, "move", { x: 30, y: 30 }), zoneId);
        return { zoneId, tableId: table.a!, body: {} };
      },
    ],
    [
      "mark-moved",
      async () => {
        const { zoneId, tableId } = await needingMoving(v);
        return { zoneId, tableId, body: {} };
      },
    ],
    [
      "merge",
      async () => {
        const { zoneId, table } = await ROOM();
        return { zoneId, tableId: table.a!, body: { targetId: table.b!, side: "right", seats: 8 } };
      },
    ],
    [
      "split-off (a group)",
      async () => {
        const { zoneId, table } = await ROOM();
        await expectRevision(
          v,
          today(table.a!, "merge", { targetId: table.b!, side: "right", seats: 8 }),
          zoneId,
        );
        return { zoneId, tableId: table.a!, body: { partIds: [table.b!] } };
      },
      "split-off",
    ],
    [
      "split-off",
      async () => {
        const { zoneId, table } = await LONG();
        return { zoneId, tableId: table.long!, body: { partIds: [table.c5!], seats: 6 } };
      },
    ],
    [
      "reset",
      async () => {
        const { zoneId, table } = await LONG();
        await expectRevision(
          v,
          today(table.long!, "split-off", { partIds: [table.c5!], seats: 6 }),
          zoneId,
        );
        return { zoneId, tableId: table.long!, body: { partIds: [table.c5!] } };
      },
    ],
    [
      "name",
      async () => {
        const { zoneId, table } = await ROOM();
        return { zoneId, tableId: table.a!, body: { name: `Window ${randomUUID().slice(0, 6)}` } };
      },
    ],
  ];

  it.each(ROUTES)(
    "%s with no revision is refused and writes nothing",
    async (label, setup, change = label) => {
      const { zoneId, tableId, body } = await setup();
      const read = await zoneRevisionOf(v, zoneId);
      const before = await everything();

      expect(await refusal(send("POST", `/api/tables/${tableId}/today/${change}`, body))).toEqual({
        status: 400,
        body: { error: { code: "management.request_invalid", params: { field: "zoneRevision" } } },
      });
      expect(await everything()).toEqual(before);
      expect(await zoneRevisionOf(v, zoneId)).toBe(read);
    },
  );

  it.each(ROUTES)(
    "%s refuses a second till acting from the old revision and writes nothing",
    async (label, setup, change = label) => {
      const { zoneId, tableId, body } = await setup();
      const read = (await zoneRevisionOf(v, zoneId))!;

      await expectRevision(
        v,
        today(tableId, change, { ...body, zoneRevision: read }),
        zoneId,
        read + 1,
      );
      const before = await everything();

      expect(await refusal(today(tableId, change, { ...body, zoneRevision: read }))).toEqual(
        outOfDate(zoneId, read + 1),
      );
      expect(await everything()).toEqual(before);
      expect(await zoneRevisionOf(v, zoneId)).toBe(read + 1);
    },
  );

  it("the same request sending the current revision is applied and answers the next one", async () => {
    const { zoneId, table } = await ROOM();
    const read = (await zoneRevisionOf(v, zoneId))!;

    await expectRevision(
      v,
      today(table.a!, "move", { x: 30, y: 30, zoneRevision: read }),
      zoneId,
      read + 1,
    );
    await expectRevision(
      v,
      today(table.a!, "move", { x: 40, y: 40, zoneRevision: read + 1 }),
      zoneId,
      read + 2,
    );
    expect(await todayRow(v, table.a!)).toMatchObject({ x: 40, y: 40 });
  });

  it("a request that writes nothing answers the revision unchanged", async () => {
    const { zoneId, table } = await ROOM();
    const read = (await zoneRevisionOf(v, zoneId))!;

    await expectRevision(v, today(table.a!, "put-back", { zoneRevision: read }), zoneId, read);
  });

  it("a request sending the current revision still meets the route's own refusal, writing nothing", async () => {
    const { zoneId, table } = await ROOM();
    await seatAt(table.a!);
    const read = (await zoneRevisionOf(v, zoneId))!;
    const before = await everything();

    expect(await refusal(today(table.a!, "take-off", { zoneRevision: read }))).toEqual({
      status: 409,
      body: { error: { code: "tab.already_open", params: { tableId: table.a! } } },
    });
    expect(await everything()).toEqual(before);
    expect(await zoneRevisionOf(v, zoneId)).toBe(read);
  });

  it("a stale screen is refused when the catch-up changes the room", async () => {
    const { zoneId, table, master, revision } = await plannedZone(v, [
      { key: "bar", label: "Bar", place: { x: 40, y: 0 } },
      { key: "a", place: { x: 0, y: 0 } },
    ]);
    const partyId = await seatAt(table.bar!);
    const label = (await tableRow(v, table.bar!)).label;
    const other = (await tableRow(v, table.a!)).label;
    const renamed = `${label} b`;
    const entry = (key: string, name: string, x: number) => ({
      id: master[key]!,
      key,
      label: name,
      seats: 4,
      fixed: false,
      placement: { x, y: 0, width: 8, height: 8, shape: "rect" as const, rotation: 0 },
      partKeys: [],
    });
    await inTx(v, async (tx) =>
      saveLayout(tx, v.cfg, REMOVALS, await defaultLayout(tx, v.cfg, zoneId), {
        revision,
        tables: [entry("bar", renamed, 40), entry("a", other, 0)],
      }),
    );
    await expectRevision(v, resetZoneToday(zoneId), zoneId);
    expect((await tableRow(v, table.bar!)).label).toBe(label);
    await finish(partyId);
    const read = (await zoneRevisionOf(v, zoneId))!;
    const before = await everything();

    expect(await refusal(today(table.a!, "move", { x: 20, y: 20, zoneRevision: read }))).toEqual(
      outOfDate(zoneId, read + 1),
    );

    expect((await tableRow(v, table.bar!)).label).toBe(label);
    expect(await everything()).toEqual(before);
    expect(await zoneRevisionOf(v, zoneId)).toBe(read);
    await floorToday(table.bar!);
    expect((await tableRow(v, table.bar!)).label).toBe(renamed);
    expect(await zoneRevisionOf(v, zoneId)).toBe(read + 1);
  });

  it("refuses a till splitting Counter 4 off Long table from the read before another split Counter 5 off (A564)", async () => {
    const { zoneId, table } = await LONG();
    const read = (await zoneRevisionOf(v, zoneId))!;
    await expectRevision(
      v,
      today(table.long!, "split-off", { partIds: [table.c5!], seats: 6, zoneRevision: read }),
      zoneId,
      read + 1,
    );
    const before = await everything();

    expect(
      await refusal(
        today(table.long!, "split-off", { partIds: [table.c4!], seats: 8, zoneRevision: read }),
      ),
    ).toEqual(outOfDate(zoneId, read + 1));

    expect(await everything()).toEqual(before);
    expect(await todayRow(v, table.c4!)).toMatchObject({ x: null });
  });

  it("refuses a revision that is not a whole number from 0", async () => {
    const { zoneId, table } = await ROOM();
    const before = await everything();

    for (const zoneRevision of [-1, 1.5, "3", null]) {
      expect(await refusal(today(table.a!, "move", { x: 30, y: 30, zoneRevision }))).toEqual({
        status: 400,
        body: {
          error: { code: "management.request_invalid", params: { field: "zoneRevision" } },
        },
      });
    }
    expect(await everything()).toEqual(before);
    expect(await zoneRevisionOf(v, zoneId)).toBe(1);
  });
});

describe("today's routes", () => {
  it("moves, turns, takes off, puts back, places and sets seats through the routes, answering the room's revision", async () => {
    const { table } = await plannedZone(v, [
      { key: "a", place: { x: 0, y: 0 } },
      { key: "spare", place: null },
    ]);

    await expectRevision(v, today(table.a!, "move", { x: 30, y: 12 }));
    expect((await floorToday(table.a!))?.placement).toMatchObject({ x: 30, y: 12, rotation: 0 });

    await expectRevision(v, today(table.a!, "rotate"));
    expect((await floorToday(table.a!))?.placement).toMatchObject({ x: 30, y: 12, rotation: 15 });

    await expectRevision(v, today(table.a!, "seats", { seats: 7 }));
    expect((await floorToday(table.a!))?.seats).toBe(7);

    await expectRevision(v, today(table.a!, "take-off"));
    expect(await floorToday(table.a!)).toMatchObject({ placement: null, takenOff: true });

    await expectRevision(v, today(table.a!, "put-back"));
    expect(await floorToday(table.a!)).toMatchObject({
      placement: { x: 30, y: 12, rotation: 15 },
      takenOff: false,
    });

    expect((await floorToday(table.spare!))?.placement).toBeNull();
    await expectRevision(v, today(table.spare!, "place", { x: 40, y: 50 }));
    expect((await floorToday(table.spare!))?.placement).toMatchObject({
      x: 40,
      y: 50,
      width: 8,
      height: 8,
      shape: "rect",
      rotation: 0,
    });
  });

  it("sends a table back to its saved place", async () => {
    const { table } = await plannedZone(v, [{ key: "a", seats: 4, place: { x: 10, y: 20 } }]);
    await expectRevision(v, today(table.a!, "move", { x: 60, y: 60 }));
    await expectRevision(v, today(table.a!, "rotate"));

    await expectRevision(v, today(table.a!, "back"));

    expect(await floorToday(table.a!)).toMatchObject({
      placement: { x: 10, y: 20, rotation: 0 },
      seats: 4,
      takenOff: false,
    });
  });

  it("resets a zone to the layout", async () => {
    const { zoneId, table } = await plannedZone(v, [
      { key: "free", place: { x: 0, y: 0 } },
      { key: "seated", place: { x: 20, y: 0 } },
    ]);
    await seatAt(table.seated!);
    await expectRevision(v, today(table.free!, "move", { x: 50, y: 50 }));
    await expectRevision(v, today(table.seated!, "move", { x: 70, y: 70 }));

    const before = (await zoneRevisionOf(v, zoneId))!;
    await expectRevision(v, resetZoneToday(zoneId), zoneId, before + 1);

    expect((await floorToday(table.free!))?.placement).toMatchObject({ x: 0, y: 0 });
    expect((await floorToday(table.seated!))?.placement).toMatchObject({ x: 70, y: 70 });
  });

  it("a change sent from a read after the catch-up marks a table is applied, and survives the next read", async () => {
    const { zoneId, table, master, revision } = await plannedZone(v, [
      { key: "t", label: "T", place: { x: 0, y: 0 } },
    ]);
    const partyId = await seatAt(table.t!);
    const label = (await tableRow(v, table.t!)).label;
    await inTx(v, async (tx) =>
      saveLayout(tx, v.cfg, REMOVALS, await defaultLayout(tx, v.cfg, zoneId), {
        revision,
        tables: [
          {
            id: master.t!,
            key: "t",
            label,
            seats: 4,
            fixed: false,
            placement: { x: 50, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 },
            partKeys: [],
          },
        ],
      }),
    );
    await expectRevision(v, resetZoneToday(zoneId), zoneId);
    expect((await todayRow(v, table.t!))?.x).toBe(0);
    await finish(partyId);
    const stored = (await zoneRevisionOf(v, zoneId))!;
    const read = (await floorToday(table.t!))!;
    expect(read.placement).toMatchObject({ x: 0, y: 0 });
    expect(read.needsMoving).toBe(true);
    expect(read.zoneRevision).toBe(stored + 1);

    await expectRevision(
      v,
      today(table.t!, "move", { x: 30, y: 0, zoneRevision: read.zoneRevision }),
      zoneId,
      stored + 2,
    );

    expect((await floorToday(table.t!))?.placement).toMatchObject({ x: 30, y: 0 });
  });

  it("leaves a disabled planned zone's tables off on a reset", async () => {
    const { zoneId, table } = await plannedZone(v, [{ key: "a" }]);
    await inTx(v, async (tx) =>
      tx.execute(sql`update floor_zones set active = false where id = ${zoneId}`),
    );
    expect(await inService(table.a!)).toBe(false);
    const zoneRevision = await zoneRevisionOf(v, zoneId);
    expect(zoneRevision).toBe(1);

    await expectRevision(v, resetZoneToday(zoneId), zoneId, 1);

    expect(await inService(table.a!)).toBe(false);
    expect(await zoneRevisionOf(v, zoneId)).toBe(zoneRevision);
  });

  it("answers a refusal with its code and status", async () => {
    const { table } = await plannedZone(v, [
      { key: "fixed", fixed: true },
      { key: "spare", place: null },
      { key: "off", place: { x: 20, y: 0 } },
    ]);
    await expectRevision(v, today(table.off!, "take-off"));

    expect(await refusal(today(table.fixed!, "move", { x: 5, y: 5 }))).toEqual({
      status: 409,
      body: { error: { code: "table.fixed", params: { tableId: table.fixed! } } },
    });
    expect(await refusal(today(table.spare!, "rotate"))).toEqual({
      status: 409,
      body: { error: { code: "table.not_on_today_plan", params: { tableId: table.spare! } } },
    });
    expect(await refusal(today(table.off!, "move", { x: 5, y: 5 }))).toEqual({
      status: 409,
      body: { error: { code: "table.taken_off", params: { tableId: table.off! } } },
    });
  });

  it("answers 409 table.in_joined_table for placing a part", async () => {
    const { table } = await plannedZone(v, [
      { key: "c3", label: "Counter 3", seats: 2, place: null },
      { key: "c4", label: "Counter 4", seats: 6, place: null },
      { key: "c5", label: "Counter 5", seats: 4, place: null },
      { key: "long", label: "Long table", seats: 10, partKeys: ["c3", "c4", "c5"] },
    ]);

    expect(await refusal(today(table.c4!, "place", { x: 40, y: 50 }))).toEqual({
      status: 409,
      body: { error: { code: "table.in_joined_table", params: { tableId: table.c4! } } },
    });
    expect((await floorToday(table.c4!))?.placement).toBeNull();
  });

  it("refuses a malformed id or body", async () => {
    const { table } = await plannedZone(v, [{ key: "a" }]);

    expect(await refusal(today("not-a-uuid", "move", { x: 1, y: 0 }))).toMatchObject({
      status: 404,
      body: { error: { code: "table.not_found" } },
    });
    expect(await refusal(today(table.a!, "move", { x: 1.5, y: 0 }))).toMatchObject({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "x" } } },
    });
    expect(await refusal(today(table.a!, "move", { y: 0 }))).toMatchObject({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "x" } } },
    });
    expect(await refusal(today(table.a!, "place", { x: 0, y: 1000 }))).toMatchObject({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "y" } } },
    });
    expect(await refusal(today(table.a!, "seats", { seats: 0 }))).toMatchObject({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "seats" } } },
    });
    expect(await refusal(today(randomUUID(), "rotate"))).toMatchObject({
      status: 404,
      body: { error: { code: "table.not_found" } },
    });
    expect(await refusal(send("POST", "/api/zones/not-a-uuid/today/reset", {}))).toMatchObject({
      status: 404,
      body: { error: { code: "zone.not_found" } },
    });
    expect(
      await refusal(send("POST", `/api/zones/${randomUUID()}/today/reset`, { zoneRevision: 0 })),
    ).toMatchObject({ status: 404, body: { error: { code: "zone.not_found" } } });
  });

  it("refuses another venue's zone as not found, and leaves its today's plan alone", async () => {
    const elsewhere = randomUUID();
    const zoneId = randomUUID();
    await inTx(v, async (tx) => {
      await tx.insert(locations).values({
        id: elsewhere,
        name: "Other",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurant",
      });
      await tx.insert(floorZones).values({ id: zoneId, locationId: elsewhere, name: "Elsewhere" });
      const [set] = await tx
        .insert(floorPlanSets)
        .values({ locationId: elsewhere })
        .returning({ id: floorPlanSets.id });
      await tx
        .insert(floorPlans)
        .values({ zoneId, setId: set!.id, savedAt: "2026-01-01T00:00:00.000Z" });
      await tx.insert(floorTodayZones).values({ zoneId, businessDay: "2026-01-01", revision: 1 });
    });

    try {
      const answer = await send("POST", `/api/zones/${zoneId}/today/reset`, { zoneRevision: 1 });
      const [row] = await inTx(v, (tx) =>
        tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, zoneId)),
      );
      expect(row).toMatchObject({ businessDay: "2026-01-01", revision: 1 });
      expect(answer.status).toBe(404);
      expect(await answer.json()).toEqual({
        error: { code: "zone.not_found", params: { zoneId } },
      });
    } finally {
      // A location with no kitchen timing fails every later floor read (`station.timing_missing`).
      await inTx(v, async (tx) => {
        await tx.delete(floorTodayZones).where(eq(floorTodayZones.zoneId, zoneId));
        await tx.delete(floorPlans).where(eq(floorPlans.zoneId, zoneId));
        await tx.delete(floorPlanSets).where(eq(floorPlanSets.locationId, elsewhere));
        await tx.delete(floorZones).where(eq(floorZones.id, zoneId));
        await tx.delete(locations).where(eq(locations.id, elsewhere));
      });
    }
  });

  it("leaves a zone with no layout alone on a reset", async () => {
    const zoneId = await tableServiceZone(v);
    await v.table(`Unplanned ${randomUUID().slice(0, 6)}`, zoneId);

    await expectRevision(v, resetZoneToday(zoneId), zoneId, 0);

    expect(await zoneRevisionOf(v, zoneId)).toBeUndefined();
  });

  it("merges two free tables in a zone that takes payment first", async () => {
    const { zoneId, table } = await plannedZone(v, [
      { key: "a", place: { x: 0, y: 0 } },
      { key: "b", place: { x: 20, y: 0 } },
    ]);
    await payFirst(zoneId, "prepay");

    await expectRevision(
      v,
      today(table.a!, "merge", { targetId: table.b!, side: "right", seats: 8 }),
      zoneId,
    );
  });
});

describe("the zone reset's revision", () => {
  const outOfDate = (zoneId: string, revision: number) => ({
    status: 409,
    body: { error: { code: "floor_today.out_of_date", params: { zoneId, revision } } },
  });

  it("refuses a revision older than the room's and writes nothing", async () => {
    const { zoneId, table } = await plannedZone(v, [{ key: "a", place: { x: 0, y: 0 } }]);
    await seatAt(table.a!);
    await expectRevision(v, today(table.a!, "move", { x: 50, y: 50 }));
    const from = (await zoneRevisionOf(v, zoneId))!;
    const before = await everything();

    expect(await refusal(resetZoneToday(zoneId, { zoneRevision: from - 1 }))).toEqual(
      outOfDate(zoneId, from),
    );

    expect(await everything()).toEqual(before);
    expect(await zoneRevisionOf(v, zoneId)).toBe(from);
  });

  it("refuses a revision newer than the room's", async () => {
    const { zoneId } = await plannedZone(v, [{ key: "a" }]);
    const from = (await zoneRevisionOf(v, zoneId))!;
    const before = await everything();

    expect(await refusal(resetZoneToday(zoneId, { zoneRevision: from + 1 }))).toEqual(
      outOfDate(zoneId, from),
    );
    expect(await everything()).toEqual(before);
    expect(await zoneRevisionOf(v, zoneId)).toBe(from);
  });

  it("applies the room's current revision and answers it moved by one", async () => {
    const { zoneId, table } = await plannedZone(v, [{ key: "a", place: { x: 0, y: 0 } }]);
    await expectRevision(v, today(table.a!, "move", { x: 50, y: 50 }));
    const from = (await zoneRevisionOf(v, zoneId))!;

    await expectRevision(v, resetZoneToday(zoneId, { zoneRevision: from }), zoneId, from + 1);

    expect(await todayRow(v, table.a!)).toMatchObject({ x: 0, y: 0 });
  });

  it.each<[string, RequestInit]>([
    ["a body with no revision", { body: "{}", headers: { "content-type": "application/json" } }],
    ["no body", {}],
    ["a body that is not JSON", { body: "{", headers: { "content-type": "application/json" } }],
  ])("refuses %s and writes nothing", async (_, init) => {
    const { zoneId, table } = await plannedZone(v, [{ key: "a", place: { x: 0, y: 0 } }]);
    await expectRevision(v, today(table.a!, "move", { x: 50, y: 50 }));
    const from = (await zoneRevisionOf(v, zoneId))!;
    const before = await everything();

    const answer = Promise.resolve(
      app.request(`/api/zones/${zoneId}/today/reset`, {
        ...init,
        method: "POST",
        headers: { ...(init.headers as Record<string, string> | undefined), cookie },
      }),
    );
    expect(await refusal(answer)).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "zoneRevision" } } },
    });
    expect(await everything()).toEqual(before);
    expect(await zoneRevisionOf(v, zoneId)).toBe(from);
  });

  it("applies null on a room none of whose tables has a today's row", async () => {
    const { zoneId } = await plannedZone(v, []);
    expect(await zoneRevisionOf(v, zoneId)).toBe(1);

    await expectRevision(v, resetZoneToday(zoneId, { zoneRevision: null }), zoneId, 2);
  });

  it("refuses null once a table of the room has a today's row", async () => {
    const { zoneId, table } = await plannedZone(v, [{ key: "a", place: { x: 0, y: 0 } }]);
    await expectRevision(v, today(table.a!, "move", { x: 50, y: 50 }));
    const from = (await zoneRevisionOf(v, zoneId))!;
    const before = await everything();

    expect(await refusal(resetZoneToday(zoneId, { zoneRevision: null }))).toEqual(
      outOfDate(zoneId, from),
    );

    expect(await everything()).toEqual(before);
    expect(await zoneRevisionOf(v, zoneId)).toBe(from);
  });

  it("answers a disabled room's revision unchanged when it is current", async () => {
    const { zoneId } = await plannedZone(v, [{ key: "a" }]);
    await inTx(v, async (tx) =>
      tx.execute(sql`update floor_zones set active = false where id = ${zoneId}`),
    );

    await expectRevision(v, resetZoneToday(zoneId, { zoneRevision: 1 }), zoneId, 1);
  });

  it("refuses a stale reset when the catch-up changes the room, and rolls the catch-up back", async () => {
    const { zoneId, table, master, revision } = await plannedZone(v, [
      { key: "t", label: "T", place: { x: 0, y: 0 } },
    ]);
    const partyId = await seatAt(table.t!);
    const label = (await tableRow(v, table.t!)).label;
    const renamed = `${label} b`;
    await inTx(v, async (tx) =>
      saveLayout(tx, v.cfg, REMOVALS, await defaultLayout(tx, v.cfg, zoneId), {
        revision,
        tables: [
          {
            id: master.t!,
            key: "t",
            label: renamed,
            seats: 4,
            fixed: false,
            placement: { x: 0, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 },
            partKeys: [],
          },
        ],
      }),
    );
    await expectRevision(v, resetZoneToday(zoneId), zoneId);
    expect((await tableRow(v, table.t!)).label).toBe(label);
    await finish(partyId);
    expect((await tableRow(v, table.t!)).label).toBe(label);
    const read = (await zoneRevisionOf(v, zoneId))!;
    const before = await everything();

    expect(await refusal(resetZoneToday(zoneId, { zoneRevision: read }))).toEqual(
      outOfDate(zoneId, read + 1),
    );

    expect((await tableRow(v, table.t!)).label).toBe(label);
    expect(await everything()).toEqual(before);
    expect(await zoneRevisionOf(v, zoneId)).toBe(read);
  });

  it("refuses a revision that is not a whole number from 0", async () => {
    const { zoneId } = await plannedZone(v, [{ key: "a" }]);
    const before = await everything();

    for (const zoneRevision of [-1, 1.5, "3"]) {
      expect(await refusal(resetZoneToday(zoneId, { zoneRevision }))).toEqual({
        status: 400,
        body: {
          error: { code: "management.request_invalid", params: { field: "zoneRevision" } },
        },
      });
    }
    expect(await everything()).toEqual(before);
    expect(await zoneRevisionOf(v, zoneId)).toBe(1);
  });
});

describe("today's name route", () => {
  const suffix = () => randomUUID().slice(0, 6);

  it("answers the revision unchanged when a table is renamed to the name it already has", async () => {
    const { zoneId, table } = await plannedZone(v, [{ key: "bar", label: "Bar" }]);
    const name = `Window ${suffix()}`;
    await expectRevision(v, today(table.bar!, "name", { name }), zoneId);
    const read = (await zoneRevisionOf(v, zoneId))!;

    await expectRevision(v, today(table.bar!, "name", { name, zoneRevision: read }), zoneId, read);
  });

  it("refuses Split tables… and a rename from the read before another till renamed the group", async () => {
    const { zoneId, table } = await plannedZone(v, [
      { key: "a", place: { x: 0, y: 0 } },
      { key: "b", place: { x: 20, y: 0 } },
      { key: "bar", label: "Bar", place: { x: 40, y: 0 } },
    ]);
    await expectRevision(
      v,
      today(table.a!, "merge", { targetId: table.b!, side: "right", seats: 8 }),
      zoneId,
    );
    const read = (await zoneRevisionOf(v, zoneId))!;

    await expectRevision(
      v,
      today(table.a!, "name", { name: `García birthday ${suffix()}`, zoneRevision: read }),
      zoneId,
      read + 1,
    );
    const before = await everything();

    expect(
      await refusal(today(table.a!, "split-off", { partIds: [table.b!], zoneRevision: read })),
    ).toEqual({
      status: 409,
      body: { error: { code: "floor_today.out_of_date", params: { zoneId, revision: read + 1 } } },
    });
    expect(
      await refusal(today(table.bar!, "name", { name: `Window ${suffix()}`, zoneRevision: read })),
    ).toEqual({
      status: 409,
      body: { error: { code: "floor_today.out_of_date", params: { zoneId, revision: read + 1 } } },
    });
    expect(await everything()).toEqual(before);

    await expectRevision(
      v,
      today(table.a!, "split-off", { partIds: [table.b!], zoneRevision: read + 1 }),
      zoneId,
      read + 2,
    );
  });

  it("gives a name to one of two tables in two rooms renamed to it at once, and refuses the other", async () => {
    const first = await plannedZone(v, [{ key: "a", place: { x: 0, y: 0 } }]);
    const second = await plannedZone(v, [{ key: "a", place: { x: 0, y: 0 } }]);
    const name = `Window ${suffix()}`;
    const bodies = [
      await withRevision(v, first.table.a!, { name }),
      await withRevision(v, second.table.a!, { name }),
    ];

    const answers = await Promise.all([
      refusal(send("POST", `/api/tables/${first.table.a!}/today/name`, bodies[0])),
      refusal(send("POST", `/api/tables/${second.table.a!}/today/name`, bodies[1])),
    ]);

    expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
    expect(answers.find((a) => a.status === 409)!.body).toEqual({
      error: { code: "table.label_taken", params: { label: name, field: "name" } },
    });
    const names = [
      (await todayRow(v, first.table.a!))?.name ?? null,
      (await todayRow(v, second.table.a!))?.name ?? null,
    ];
    expect(names.filter((n) => n === name)).toHaveLength(1);
    expect(names.filter((n) => n === null)).toHaveLength(1);
  });

  it("names a table, and an empty name clears it", async () => {
    const { zoneId, table } = await plannedZone(v, [{ key: "a", place: { x: 0, y: 0 } }]);
    const name = `Window ${suffix()}`;

    await expectRevision(v, today(table.a!, "name", { name: `  ${name} ` }), zoneId);
    expect(await todayRow(v, table.a!)).toMatchObject({ name });

    await expectRevision(v, today(table.a!, "name", { name: "" }), zoneId);
    expect(await todayRow(v, table.a!)).toMatchObject({ name: null });
  });

  it.each([
    ["41 characters", { name: "x".repeat(41) }],
    ["a missing name", {}],
  ])("refuses %s and writes nothing", async (_, body) => {
    const { zoneId, table } = await plannedZone(v, [{ key: "a", place: { x: 0, y: 0 } }]);
    const read = await zoneRevisionOf(v, zoneId);
    const before = await everything();

    expect(await refusal(today(table.a!, "name", body))).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "name" } } },
    });
    expect(await everything()).toEqual(before);
    expect(await zoneRevisionOf(v, zoneId)).toBe(read);
  });
});

const LONG = async () => {
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
    { key: "bar", label: "Bar", seats: 4, place: { x: 40, y: 0 } },
  ]);
  await giveKeptSize(v, zone.master.c3!, { width: 2, height: 2 });
  await giveKeptSize(v, zone.master.c4!, { width: 2, height: 2 });
  return zone;
};

describe("the split-off route", () => {
  it("splits parts off over HTTP and answers the room's revision", async () => {
    const { table } = await LONG();

    await expectRevision(v, today(table.long!, "split-off", { partIds: [table.c5!], seats: 6 }));

    expect(await todayRow(v, table.c5!)).toMatchObject({ x: 14, y: 17, width: 8, height: 8 });
    expect(await todayRow(v, table.long!)).toMatchObject({ width: 4, seats: 6 });
  });

  it("answers 409 joined_table.parts_split_off to Back on Long table while a part is split off", async () => {
    const { table } = await LONG();
    await expectRevision(v, today(table.long!, "split-off", { partIds: [table.c5!], seats: 6 }));
    const longBefore = await todayRow(v, table.long!);

    expect(await refusal(today(table.long!, "back"))).toEqual({
      status: 409,
      body: { error: { code: "joined_table.parts_split_off", params: { tableId: table.long! } } },
    });
    expect(await todayRow(v, table.long!)).toEqual(longBefore);
  });

  it("answers 409 table.split_off to Back and to Take off on a part split off", async () => {
    const { table } = await LONG();
    await expectRevision(v, today(table.long!, "split-off", { partIds: [table.c5!], seats: 6 }));
    const before = await everything();

    for (const change of ["back", "take-off"]) {
      expect(await refusal(today(table.c5!, change))).toEqual({
        status: 409,
        body: { error: { code: "table.split_off", params: { tableId: table.c5! } } },
      });
    }
    expect(await everything()).toEqual(before);
  });

  it.each<
    [
      number,
      string,
      (t: Record<string, string>) => [string, unknown],
      (t: Record<string, string>) => Record<string, unknown>,
    ]
  >([
    [
      404,
      "joined_table.not_found",
      (t) => [t.bar!, { partIds: [t.c5!], seats: 6 }],
      (t) => ({ tableId: t.bar! }),
    ],
    [
      400,
      "joined_table.part_invalid",
      (t) => [t.long!, { partIds: [t.bar!], seats: 6 }],
      (t) => ({ tableId: t.bar!, field: "partIds" }),
    ],
    [
      409,
      "joined_table.split_all",
      (t) => [t.long!, { partIds: [t.c3!, t.c4!, t.c5!] }],
      (t) => ({ tableId: t.long!, field: "partIds" }),
    ],
    [400, "joined_table.seats_required", (t) => [t.long!, { partIds: [t.c5!] }], () => ({})],
  ])("answers %i %s", async (status, code, request, params) => {
    const { table } = await LONG();
    const [tableId, body] = request(table);

    expect(await refusal(today(tableId, "split-off", body))).toEqual({
      status,
      body: { error: { code, params: params(table) } },
    });
    expect(await todayRow(v, table.c5!)).toMatchObject({ x: null });
  });

  it.each<[string, (t: Record<string, string>) => unknown]>([
    ["empty", () => []],
    ["not a list", (t) => t.c3!],
    ["not a table id", () => ["not-a-uuid"]],
    ["a repeated table", (t) => [t.c3!, t.c3!]],
  ])("refuses partIds that is %s", async (_name, partIds) => {
    const { table } = await LONG();

    expect(
      await refusal(today(table.long!, "split-off", { partIds: partIds(table), seats: 6 })),
    ).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "partIds" } } },
    });
  });

  it("refuses seats that are not a whole number from 1", async () => {
    const { table } = await LONG();

    expect(
      await refusal(today(table.long!, "split-off", { partIds: [table.c5!], seats: 0 })),
    ).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "seats" } } },
    });
  });
});

describe("the joined table's reset route", () => {
  it("takes Counter 5 back over HTTP and answers the room's revision", async () => {
    const { table } = await LONG();
    await expectRevision(v, today(table.long!, "split-off", { partIds: [table.c5!], seats: 6 }));

    await expectRevision(v, today(table.long!, "reset", { partIds: [table.c5!] }));

    expect(await todayRow(v, table.long!)).toMatchObject({ width: 6, seats: 10 });
    expect(await todayRow(v, table.c5!)).toMatchObject({ x: null });
  });

  it.each<
    [
      number,
      string,
      (t: Record<string, string>) => Promise<[string, unknown]>,
      (t: Record<string, string>) => Record<string, unknown>,
    ]
  >([
    [
      404,
      "joined_table.not_found",
      async (t) => {
        await expectRevision(v, today(t.long!, "split-off", { partIds: [t.c5!], seats: 6 }));
        return [t.bar!, { partIds: [t.c5!] }];
      },
      (t) => ({ tableId: t.bar! }),
    ],
    [
      409,
      "joined_table.nothing_to_join",
      async (t) => [t.long!, { partIds: [t.c5!] }],
      (t) => ({ tableId: t.long! }),
    ],
    [
      409,
      "joined_table.out_of_date",
      async (t) => {
        await expectRevision(v, today(t.long!, "split-off", { partIds: [t.c5!], seats: 6 }));
        return [t.long!, { partIds: [t.c4!] }];
      },
      (t) => ({ tableId: t.long! }),
    ],
    [
      400,
      "joined_table.seats_required",
      async (t) => {
        await seatAt(t.long!);
        await expectRevision(v, today(t.long!, "split-off", { partIds: [t.c4!, t.c5!] }));
        return [t.long!, { partIds: [t.c4!, t.c5!] }];
      },
      () => ({}),
    ],
  ])("answers %i %s, writing nothing", async (status, code, setup, params) => {
    const { table } = await LONG();
    const [tableId, body] = await setup(table);
    const before = await everything();

    expect(await refusal(today(tableId, "reset", body))).toEqual({
      status,
      body: { error: { code, params: params(table) } },
    });
    expect(await everything()).toEqual(before);
  });

  it.each<[string, (t: Record<string, string>) => unknown]>([
    ["empty", () => []],
    ["not a list", (t) => t.c5!],
    ["not a table id", () => ["not-a-uuid"]],
    ["a repeated table", (t) => [t.c5!, t.c5!]],
  ])("refuses partIds that is %s", async (_name, partIds) => {
    const { table } = await LONG();
    await expectRevision(v, today(table.long!, "split-off", { partIds: [table.c5!], seats: 6 }));
    const before = await everything();

    expect(await refusal(today(table.long!, "reset", { partIds: partIds(table) }))).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "partIds" } } },
    });
    expect(await everything()).toEqual(before);
  });

  it("refuses seats that are not a whole number from 1", async () => {
    const { table } = await LONG();
    await expectRevision(v, today(table.long!, "split-off", { partIds: [table.c5!], seats: 6 }));
    const before = await everything();

    expect(await refusal(today(table.long!, "reset", { partIds: [table.c5!], seats: 0 }))).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "seats" } } },
    });
    expect(await everything()).toEqual(before);
  });
});

describe("the till's zone list", () => {
  it("says a zone of a department with a set has a plan, with tables, a saved layout or neither", async () => {
    const { zoneId: withTables } = await plannedZone(v, [{ key: "a" }]);
    const { zoneId: emptyPlan } = await plannedZone(v, []);
    const unplanned = await tableServiceZone(v);

    const answer = await send("GET", "/api/zones");
    expect(answer.status).toBe(200);
    const zones = (await answer.json()) as { id: string; hasPlan: boolean }[];
    const hasPlan = (zoneId: string) => zones.find((zone) => zone.id === zoneId)?.hasPlan;
    expect([hasPlan(withTables), hasPlan(emptyPlan), hasPlan(unplanned)]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("says each zone's service mode", async () => {
    const tables = await tableServiceZone(v);
    const prepay = await tableServiceZone(v);
    const ticketThenPay = await tableServiceZone(v);
    await payFirst(prepay, "prepay");
    await payFirst(ticketThenPay, "ticket_then_pay");

    const answer = await send("GET", "/api/zones");
    expect(answer.status).toBe(200);
    const zones = (await answer.json()) as { id: string; serviceMode: string | null }[];
    const listed = (zoneId: string) => zones.find((zone) => zone.id === zoneId);
    expect([listed(tables), listed(prepay), listed(ticketThenPay)]).not.toContain(undefined);
    expect([tables, prepay, ticketThenPay].map((id) => listed(id)!.serviceMode)).toEqual([
      "table_tab",
      "prepay",
      "ticket_then_pay",
    ]);
  });
});

async function payFirst(zoneId: string, paidWhen: "prepay" | "ticket_then_pay"): Promise<void> {
  await inTx(v, async (tx) => {
    await tx.execute(sql`
      update zone_sale_policies set order_start = 'counter', paid_when = ${paidWhen}
      where zone_id = ${zoneId}`);
  });
}

async function inService(tableId: string): Promise<boolean> {
  const [table] = await inTx(v, (tx) =>
    tx
      .select({ inService: tableInService(diningTables.id).mapWith(Boolean) })
      .from(diningTables)
      .where(eq(diningTables.id, tableId)),
  );
  return table!.inService;
}

describe("resetting a zone onto a layout", () => {
  it("with no record yet, leaves the zone as it is when its due set holds no saved layout", async () => {
    const zone = await inTx(v, async (tx) => {
      const department = await createDepartment(tx, v.cfg, {
        name: `Dept ${randomUUID().slice(0, 8)}`,
        orderStart: "table",
      });
      const { id: zoneId } = await createServiceZone(tx, v.cfg, {
        name: `Inside ${randomUUID().slice(0, 8)}`,
        departmentId: department.id,
      });
      const [set] = await tx
        .insert(floorPlanSets)
        .values({ locationId: v.cfg.locationId })
        .returning({ id: floorPlanSets.id });
      await linkFloorPlanSet(tx, v.cfg, {
        setId: set!.id,
        departmentId: department.id,
        name: "Standard",
      });
      const [unlinked] = await tx
        .insert(floorPlanSets)
        .values({ locationId: v.cfg.locationId })
        .returning({ id: floorPlanSets.id });
      await tx
        .insert(floorPlans)
        .values({ zoneId, setId: unlinked!.id, savedAt: "2026-01-01T00:00:00.000Z" });
      return { zoneId, standard: set!.id };
    });

    await expectRevision(v, resetZoneToday(zone.zoneId), zone.zoneId, 0);

    const [row] = await inTx(v, (tx) =>
      tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, zone.zoneId)),
    );
    expect(row).toBeUndefined();
  });

  it("leaves a zone whose department has no set as it is, answering its revision", async () => {
    const zoneId = await inTx(v, async (tx) => {
      const department = await createDepartment(tx, v.cfg, {
        name: `Dept ${randomUUID().slice(0, 8)}`,
        orderStart: "table",
      });
      const { id } = await createServiceZone(tx, v.cfg, {
        name: `Setless ${randomUUID().slice(0, 8)}`,
        departmentId: department.id,
      });
      const [unlinked] = await tx
        .insert(floorPlanSets)
        .values({ locationId: v.cfg.locationId })
        .returning({ id: floorPlanSets.id });
      await tx
        .insert(floorPlans)
        .values({ zoneId: id, setId: unlinked!.id, savedAt: "2026-01-01T00:00:00.000Z" });
      return id;
    });

    await expectRevision(v, resetZoneToday(zoneId), zoneId, 0);

    expect(
      await inTx(v, (tx) =>
        tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, zoneId)),
      ),
    ).toEqual([]);
  });
});

describe("Reset to … plan", () => {
  /** Venue times are Madrid's; Lunch runs 12:00-15:00 and Dinner 20:00-23:00. */
  const LUNCH = new Date("2026-10-12T13:00:00+02:00");
  const DINNER = new Date("2026-10-12T21:00:00+02:00");

  const layoutChanged = (zoneId: string) => ({
    status: 409,
    body: { error: { code: "floor_today.layout_changed", params: { zoneId } } },
  });

  /** Standard stands A at 0 and B at 20; Dinner stands them at 40 and 60. Read at `at`. */
  async function twoSets(at: Date) {
    fixedAt = at;
    const s = await standardAndDinner(
      v,
      at,
      [
        { key: "a", label: `A ${randomUUID().slice(0, 6)}` },
        { key: "b", label: `B ${randomUUID().slice(0, 6)}` },
      ],
      { standard: { a: 0, b: 20 }, dinner: { a: 40, b: 60 } },
    );
    expect((await send("GET", "/api/tables/state")).status).toBe(200);
    return s;
  }

  async function recordOf(zoneId: string) {
    const [row] = await inTx(v, (tx) =>
      tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, zoneId)),
    );
    return row;
  }

  async function layoutRevision(setId: string, zoneId: string): Promise<number> {
    return (await inTx(v, (tx) => readLayout(tx, v.cfg, { setId, zoneId }))).revision;
  }

  async function moveInLayout(setId: string, zoneId: string, tableId: string, x: number) {
    await inTx(v, async (tx) => {
      const plan = await readLayout(tx, v.cfg, { setId, zoneId });
      await saveLayout(
        tx,
        v.cfg,
        REMOVALS,
        { setId, zoneId },
        {
          revision: plan.revision,
          tables: plan.tables.map((t) => ({
            id: t.id,
            key: t.id,
            label: t.label,
            seats: t.seats,
            fixed: t.fixed,
            placement:
              t.liveTableId === tableId && t.placement !== null
                ? { ...t.placement, x }
                : t.placement,
            partKeys: t.partIds,
          })),
        },
        fixedAt!,
      );
    });
  }

  async function moveToDepartment(zoneId: string, departmentId: string): Promise<void> {
    await inTx(v, (tx) =>
      tx
        .update(zoneServicePolicies)
        .set({ departmentId })
        .where(eq(zoneServicePolicies.zoneId, zoneId)),
    );
  }

  async function newDepartment(withSet: boolean): Promise<string> {
    return inTx(v, async (tx) => {
      const department = await createDepartment(tx, v.cfg, {
        name: `Dept ${randomUUID().slice(0, 8)}`,
        orderStart: "table",
      });
      if (withSet) {
        const [set] = await tx
          .insert(floorPlanSets)
          .values({ locationId: v.cfg.locationId })
          .returning({ id: floorPlanSets.id });
        await linkFloorPlanSet(tx, v.cfg, {
          setId: set!.id,
          departmentId: department.id,
          name: "Standard",
        });
      }
      return department.id;
    });
  }

  it("resets onto the recorded set, brings its edit, keeps the occurrence, and undoes taken-off", async () => {
    const { d, live } = await twoSets(LUNCH);
    const recorded = await recordOf(d.zoneId);
    expect(recorded).toMatchObject({ setId: d.standard });
    expect(recorded!.occurrence).not.toBeNull();
    await moveInLayout(d.standard, d.zoneId, live("a"), 10);
    await expectRevision(v, today(live("b"), "take-off"), d.zoneId);
    expect(await floorToday(live("b"))).toMatchObject({ takenOff: true });

    await expectRevision(v, resetZoneToday(d.zoneId), d.zoneId);

    expect(await todayRow(v, live("a"))).toMatchObject({ x: 10, y: 0 });
    expect(await floorToday(live("b"))).toMatchObject({ takenOff: false });
    expect(await recordOf(d.zoneId)).toMatchObject({
      setId: d.standard,
      layoutRevision: await layoutRevision(d.standard, d.zoneId),
      occurrence: recorded!.occurrence,
    });
  });

  it("never brings another set: Dinner due, Standard recorded, resets onto Standard", async () => {
    const { d, live } = await twoSets(LUNCH);
    const recorded = await recordOf(d.zoneId);
    await expectRevision(v, today(live("a"), "move", { x: 90, y: 0 }), d.zoneId);
    fixedAt = DINNER;

    await expectRevision(v, resetZoneToday(d.zoneId), d.zoneId);

    expect(await todayRow(v, live("a"))).toMatchObject({ x: 0, y: 0 });
    expect(await recordOf(d.zoneId)).toMatchObject({
      setId: d.standard,
      occurrence: recorded!.occurrence,
    });
    const zones = (await (await send("GET", "/api/zones")).json()) as {
      id: string;
      layoutDue: { setId: string } | null;
    }[];
    expect(zones.find((zone) => zone.id === d.zoneId)!.layoutDue).toMatchObject({
      setId: d.dinner,
    });
  });

  it("is refused when the recorded set is gone, and writes nothing", async () => {
    const { d } = await twoSets(DINNER);
    expect(await recordOf(d.zoneId)).toMatchObject({ setId: d.dinner });
    await inTx(v, async (tx) => {
      await tx
        .update(menuPeriods)
        .set({ floorPlanSetId: null })
        .where(eq(menuPeriods.floorPlanSetId, d.dinner));
      await tx.delete(departmentFloorPlanSets).where(eq(departmentFloorPlanSets.setId, d.dinner));
      await floorDeletionFor(v.cfg, REMOVALS).removeSets(tx, [d.dinner]);
    });
    const from = (await zoneRevisionOf(v, d.zoneId))!;
    const before = await everything();

    expect(await refusal(resetZoneToday(d.zoneId))).toEqual(layoutChanged(d.zoneId));

    expect(await everything()).toEqual(before);
    expect(await zoneRevisionOf(v, d.zoneId)).toBe(from);
  });

  it("counts a recorded set of the zone's old department as gone", async () => {
    const { d } = await twoSets(LUNCH);
    await moveToDepartment(d.zoneId, await newDepartment(true));
    const from = (await zoneRevisionOf(v, d.zoneId))!;
    const before = await everything();

    expect(await refusal(resetZoneToday(d.zoneId))).toEqual(layoutChanged(d.zoneId));

    expect(await everything()).toEqual(before);
    expect(await zoneRevisionOf(v, d.zoneId)).toBe(from);
  });

  it("leaves a zone moved to a department with no set as it is", async () => {
    const { d, live } = await twoSets(LUNCH);
    await expectRevision(v, today(live("a"), "move", { x: 90, y: 0 }), d.zoneId);
    await moveToDepartment(d.zoneId, await newDepartment(false));
    const from = (await zoneRevisionOf(v, d.zoneId))!;
    const record = await recordOf(d.zoneId);

    await expectRevision(v, resetZoneToday(d.zoneId), d.zoneId, from);

    expect(await todayRow(v, live("a"))).toMatchObject({ x: 90 });
    expect(await recordOf(d.zoneId)).toEqual(record);
  });

  it("resets a zone whose department has a set onto its recorded set, though no set holds its layout", async () => {
    fixedAt = LUNCH;
    const d = await setsDepartment(v, new Date("2026-10-09T06:00:00Z"));
    await inTx(v, (tx) =>
      resetZone(tx, v.cfg, REMOVALS, d.zoneId, LUNCH, { setId: d.standard, occurrence: null }),
    );
    expect(await recordOf(d.zoneId)).toMatchObject({ setId: d.standard, revision: 1 });

    await expectRevision(v, resetZoneToday(d.zoneId), d.zoneId, 2);
  });

  it("does not take a record of an earlier business day for today's", async () => {
    fixedAt = LUNCH;
    const d = await setsDepartment(v, new Date("2026-10-09T06:00:00Z"));
    await inTx(v, async (tx) => {
      await tx
        .insert(floorPlans)
        .values({ zoneId: d.zoneId, setId: d.dinner, savedAt: LUNCH.toISOString() });
      await tx.insert(floorTodayZones).values({
        zoneId: d.zoneId,
        businessDay: "2026-10-11",
        revision: 1,
        setId: d.standard,
        occurrence: null,
      });
    });

    await expectRevision(v, resetZoneToday(d.zoneId, { zoneRevision: 1 }), d.zoneId, 1);

    expect(await recordOf(d.zoneId)).toMatchObject({ businessDay: "2026-10-11", revision: 1 });
  });

  it("resets a zone with no record yet onto the due layout", async () => {
    fixedAt = DINNER;
    const d = await setsDepartment(v, new Date("2026-10-09T06:00:00Z"));
    await inTx(v, (tx) =>
      tx
        .insert(floorPlans)
        .values({ zoneId: d.zoneId, setId: d.dinner, savedAt: LUNCH.toISOString() }),
    );
    expect(await recordOf(d.zoneId)).toBeUndefined();

    await expectRevision(v, resetZoneToday(d.zoneId, { zoneRevision: null }), d.zoneId);

    const record = await recordOf(d.zoneId);
    expect(record).toMatchObject({ businessDay: "2026-10-12", setId: d.dinner });
    expect(record!.occurrence).not.toBeNull();
  });
});

describe("Update layout", () => {
  /** Venue times are Madrid's; Lunch runs 12:00-15:00 and Dinner 20:00-23:00. */
  const LUNCH = new Date("2026-10-12T13:00:00+02:00");
  const AFTER_LUNCH = new Date("2026-10-12T16:20:00+02:00");

  /**
   * The owner's example: Standard stands 1, 3, 4, 5 and 9 at 0-80 and leaves 4+5 off; Dinner
   * stands 1 at 100, 3 at 120, 4+5 at 140 and 9 at 160. Read at Lunch, so Standard is recorded.
   */
  async function ownersExample() {
    fixedAt = LUNCH;
    const tag = randomUUID().slice(0, 6);
    const s = await standardAndDinner(
      v,
      LUNCH,
      [
        { key: "one", label: `1 ${tag}` },
        { key: "three", label: `3 ${tag}` },
        { key: "four", label: `4 ${tag}` },
        { key: "five", label: `5 ${tag}` },
        { key: "joined", label: `4+5 ${tag}`, partKeys: ["four", "five"] },
        { key: "nine", label: `9 ${tag}` },
      ],
      {
        standard: { one: 0, three: 20, four: 40, five: 60, joined: null, nine: 80 },
        dinner: { one: 100, three: 120, four: null, five: null, joined: 140, nine: 160 },
      },
    );
    expect((await send("GET", "/api/tables/state")).status).toBe(200);
    return s;
  }

  async function offered(zoneId: string) {
    const zones = (await (await send("GET", "/api/zones")).json()) as {
      id: string;
      layoutDue: { setId: string; revision: number; periodName: string | null } | null;
    }[];
    return zones.find((zone) => zone.id === zoneId)!.layoutDue;
  }

  async function updateLayout(zoneId: string, body: unknown): Promise<Response> {
    return send(
      "POST",
      `/api/zones/${zoneId}/today/update-layout`,
      await withZoneRevision(v, zoneId, body),
    );
  }

  async function recordOf(zoneId: string) {
    const [row] = await inTx(v, (tx) =>
      tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, zoneId)),
    );
    return row;
  }

  const layoutChanged = (zoneId: string) => ({
    status: 409,
    body: { error: { code: "floor_today.layout_changed", params: { zoneId } } },
  });

  it("applies the offered layout and records it", async () => {
    const { d, live } = await ownersExample();
    expect(await recordOf(d.zoneId)).toMatchObject({ setId: d.standard });
    await expectRevision(v, today(live("nine"), "take-off"), d.zoneId);
    const partyId = await seatAt(live("three"));
    fixedAt = AFTER_LUNCH;
    const offer = (await offered(d.zoneId))!;
    expect(offer).toMatchObject({ setId: d.dinner, periodName: "Dinner" });

    await expectRevision(
      v,
      updateLayout(d.zoneId, { setId: offer.setId, layoutRevision: offer.revision }),
      d.zoneId,
    );

    expect(await todayRow(v, live("one"))).toMatchObject({ x: 100 });
    expect(await todayRow(v, live("joined"))).toMatchObject({ x: 140, takenOff: false });
    expect(await inService(live("joined"))).toBe(true);
    expect(await todayRow(v, live("four"))).toMatchObject({ x: null });
    expect(await todayRow(v, live("five"))).toMatchObject({ x: null });
    expect(await todayRow(v, live("nine"))).toMatchObject({ x: 160, takenOff: true });
    expect(await todayRow(v, live("three"))).toMatchObject({ x: 20 });
    expect(await recordOf(d.zoneId)).toMatchObject({
      setId: d.dinner,
      layoutRevision: offer.revision,
      occurrence: JSON.stringify([d.departmentId, "2026-10-12", d.dinnerPeriod, "20:00"]),
    });
    expect(await offered(d.zoneId)).toBeNull();

    await finish(partyId);
    expect(await floorToday(live("three"))).toMatchObject({
      placement: { x: 20 },
      needsMoving: true,
    });
  });

  it("refuses a layout no longer due, and writes nothing", async () => {
    const { d } = await ownersExample();
    fixedAt = AFTER_LUNCH;
    const offer = (await offered(d.zoneId))!;
    const from = (await zoneRevisionOf(v, d.zoneId))!;
    const before = await everything();
    const record = await recordOf(d.zoneId);

    for (const sent of [
      { setId: d.standard, layoutRevision: offer.revision },
      { setId: d.dinner, layoutRevision: offer.revision + 1 },
      { setId: randomUUID(), layoutRevision: offer.revision },
    ]) {
      expect(await refusal(updateLayout(d.zoneId, sent))).toEqual(layoutChanged(d.zoneId));
    }

    expect(await everything()).toEqual(before);
    expect(await recordOf(d.zoneId)).toEqual(record);
    expect(await zoneRevisionOf(v, d.zoneId)).toBe(from);
  });

  it("checks the room first: a stale revision is out of date though the layout also changed", async () => {
    const { d } = await ownersExample();
    fixedAt = AFTER_LUNCH;
    const from = (await zoneRevisionOf(v, d.zoneId))!;

    expect(
      await refusal(
        updateLayout(d.zoneId, { zoneRevision: from - 1, setId: d.standard, layoutRevision: 0 }),
      ),
    ).toEqual({
      status: 409,
      body: {
        error: { code: "floor_today.out_of_date", params: { zoneId: d.zoneId, revision: from } },
      },
    });
    expect(await zoneRevisionOf(v, d.zoneId)).toBe(from);
  });

  it("applies null for a room whose running layout stands none of its tables, and records the due layout", async () => {
    fixedAt = LUNCH;
    const d = await setsDepartment(v, new Date("2026-10-09T06:00:00Z"));
    const empty = await inTx(v, (tx) =>
      readLayout(tx, v.cfg, { setId: d.standard, zoneId: d.zoneId }),
    );
    await inTx(v, (tx) =>
      saveLayout(
        tx,
        v.cfg,
        REMOVALS,
        { setId: d.standard, zoneId: d.zoneId },
        { revision: empty.revision, tables: [] },
        LUNCH,
      ),
    );
    expect((await send("GET", "/api/tables/state")).status).toBe(200);
    expect(await recordOf(d.zoneId)).toMatchObject({ setId: d.standard });
    const plan = await inTx(v, (tx) =>
      readLayout(tx, v.cfg, { setId: d.dinner, zoneId: d.zoneId }),
    );
    const { ids } = await inTx(v, (tx) =>
      saveLayout(
        tx,
        v.cfg,
        REMOVALS,
        { setId: d.dinner, zoneId: d.zoneId },
        {
          revision: plan.revision,
          tables: [
            {
              key: "one",
              label: `1 ${randomUUID().slice(0, 6)}`,
              seats: 4,
              fixed: false,
              placement: { x: 100, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 },
              partKeys: [],
            },
          ],
        },
        LUNCH,
      ),
    );
    const read = await send("GET", "/api/tables/state");
    expect(read.status).toBe(200);
    const tables = (await read.json()) as { zoneId: string | null; today: unknown }[];
    expect(tables.filter((t) => t.zoneId === d.zoneId && t.today !== null)).toEqual([]);
    const from = (await zoneRevisionOf(v, d.zoneId))!;
    fixedAt = AFTER_LUNCH;
    const offer = (await offered(d.zoneId))!;
    expect(offer).toMatchObject({ setId: d.dinner, periodName: "Dinner" });

    await expectRevision(
      v,
      updateLayout(d.zoneId, {
        zoneRevision: null,
        setId: offer.setId,
        layoutRevision: offer.revision,
      }),
      d.zoneId,
      from + 1,
    );

    const dinner = await inTx(v, (tx) =>
      readLayout(tx, v.cfg, { setId: d.dinner, zoneId: d.zoneId }),
    );
    const one = dinner.tables.find((t) => t.id === ids.one)!.liveTableId!;
    expect(await todayRow(v, one)).toMatchObject({ x: 100 });
    expect(await recordOf(d.zoneId)).toMatchObject({
      setId: d.dinner,
      layoutRevision: offer.revision,
    });
    expect(await offered(d.zoneId)).toBeNull();
  });

  it("refuses null once a table of the room has a today's row, and writes nothing", async () => {
    const { d } = await ownersExample();
    fixedAt = AFTER_LUNCH;
    const offer = (await offered(d.zoneId))!;
    const from = (await zoneRevisionOf(v, d.zoneId))!;
    const before = await everything();
    const record = await recordOf(d.zoneId);

    expect(
      await refusal(
        updateLayout(d.zoneId, {
          zoneRevision: null,
          setId: offer.setId,
          layoutRevision: offer.revision,
        }),
      ),
    ).toEqual({
      status: 409,
      body: {
        error: { code: "floor_today.out_of_date", params: { zoneId: d.zoneId, revision: from } },
      },
    });
    expect(await everything()).toEqual(before);
    expect(await recordOf(d.zoneId)).toEqual(record);
    expect(await zoneRevisionOf(v, d.zoneId)).toBe(from);
  });

  it("refuses a malformed body", async () => {
    const { d } = await ownersExample();
    for (const [body, field] of [
      [{ setId: "nope", layoutRevision: 0 }, "setId"],
      [{ layoutRevision: 0 }, "setId"],
      [{ setId: d.dinner, layoutRevision: -1 }, "layoutRevision"],
      [{ setId: d.dinner, layoutRevision: 1.5 }, "layoutRevision"],
      [{ setId: d.dinner }, "layoutRevision"],
    ] as const) {
      const answer = await refusal(updateLayout(d.zoneId, body));
      expect(answer.status, JSON.stringify(body)).toBe(400);
      expect(answer.body, JSON.stringify(body)).toMatchObject({ error: { params: { field } } });
    }
  });

  it("keeps a party's table, bills and tickets", async () => {
    const { d, live } = await ownersExample();
    const partyId = await seatAt(live("three"));
    const burger = await pricedInZone(v, d.zoneId, "Burger", "12.00");
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, partyId, {
        groups: [{ lines: [{ menuItemId: burger, quantity: "1" }], release: "fire" }],
        operatorId: OPERATOR,
      }),
    );
    const kept = async () => ({
      parties: await inTx(v, (tx) =>
        tx.select().from(partyTables).where(eq(partyTables.partyId, partyId)),
      ),
      bills: await inTx(v, (tx) =>
        tx.select().from(workingOrders).where(eq(workingOrders.partyId, partyId)),
      ),
      tickets: await inTx(v, (tx) => tx.select().from(ticketItems).orderBy(asc(ticketItems.id))),
    });
    const before = await kept();
    expect(before.parties).toHaveLength(1);
    expect(before.bills.length).toBeGreaterThan(0);
    expect(before.tickets.length).toBeGreaterThan(0);
    // pricedInZone serves the burger through an all-day period; it picks Dinner's set here.
    await inTx(v, (tx) =>
      tx
        .update(menuPeriods)
        .set({ floorPlanSetId: d.dinner })
        .where(eq(menuPeriods.departmentId, d.departmentId)),
    );
    fixedAt = AFTER_LUNCH;
    const offer = (await offered(d.zoneId))!;
    expect(offer).toMatchObject({ setId: d.dinner });

    await expectRevision(
      v,
      updateLayout(d.zoneId, { setId: offer.setId, layoutRevision: offer.revision }),
      d.zoneId,
    );

    expect(await kept()).toEqual(before);
    expect(await todayRow(v, live("three"))).toMatchObject({ x: 20 });
  });

  /**
   * 4 and 5 stand at 40 and 60 with 4+5 off in both sets; Dinner moves 5 to 160, and `spare`
   * stands at 0. At Lunch 5 is taken off and guests sit at 4, so Update layout leaves the group
   * waiting for them.
   */
  async function waitingGroup() {
    fixedAt = LUNCH;
    const tag = randomUUID().slice(0, 6);
    const s = await standardAndDinner(
      v,
      LUNCH,
      [
        { key: "four", label: `4 ${tag}` },
        { key: "five", label: `5 ${tag}` },
        { key: "joined", label: `4+5 ${tag}`, partKeys: ["four", "five"] },
        { key: "spare", label: `S ${tag}` },
      ],
      {
        standard: { four: 40, five: 60, joined: null, spare: 0 },
        dinner: { four: 40, five: 160, joined: null, spare: 0 },
      },
    );
    const { d, live } = s;
    expect((await send("GET", "/api/tables/state")).status).toBe(200);
    await expectRevision(v, today(live("five"), "take-off"), d.zoneId);
    const partyId = await seatAt(live("four"));
    fixedAt = AFTER_LUNCH;
    const offer = (await offered(d.zoneId))!;
    await expectRevision(
      v,
      updateLayout(d.zoneId, { setId: offer.setId, layoutRevision: offer.revision }),
      d.zoneId,
    );
    expect(await todayRow(v, live("five"))).toMatchObject({ x: 60, takenOff: true });
    return { ...s, partyId };
  }

  it("keeps a taken-off table that waits with its joined group off when the group applies later", async () => {
    const { live, partyId } = await waitingGroup();

    await finish(partyId);

    expect(await floorToday(live("four"))).toMatchObject({ needsMoving: false });
    expect(await todayRow(v, live("five"))).toMatchObject({ x: 160, takenOff: true });
  });

  it("leaves a taken-off table put back on after Update layout on when its group frees", async () => {
    const { d, live, partyId } = await waitingGroup();
    await expectRevision(v, today(live("five"), "put-back"), d.zoneId);

    await finish(partyId);

    expect(await todayRow(v, live("five"))).toMatchObject({ x: 60, takenOff: false });
    expect(await floorToday(live("five"))).toMatchObject({ needsMoving: true });

    await expectRevision(v, today(live("five"), "mark-moved"), d.zoneId);

    expect(await todayRow(v, live("five"))).toMatchObject({ x: 160, takenOff: false });
  });

  it("applies a waiting taken-off table later though a table stands at its new place", async () => {
    const { live, partyId } = await waitingGroup();
    await expectRevision(v, today(live("spare"), "move", { x: 160, y: 0 }));

    await finish(partyId);

    expect(await floorToday(live("four"))).toMatchObject({ needsMoving: false });
    expect(await todayRow(v, live("five"))).toMatchObject({ x: 160, takenOff: true });
    expect(await todayRow(v, live("spare"))).toMatchObject({ x: 160 });
  });

  /**
   * Dinner, as its editor saved it, stands 2 at 40 and 4 at 44, over half of 2 (both 8 by 8);
   * Standard stands 2 at 0 and 4 at `fourInStandard`. Read at Lunch, so Standard is recorded.
   */
  async function overlappingDinner(fourInStandard: number) {
    fixedAt = LUNCH;
    const tag = randomUUID().slice(0, 6);
    const s = await standardAndDinner(
      v,
      LUNCH,
      [
        { key: "two", label: `2 ${tag}` },
        { key: "four", label: `4 ${tag}` },
      ],
      { standard: { two: 0, four: fourInStandard }, dinner: { two: 40, four: 44 } },
    );
    expect((await send("GET", "/api/tables/state")).status).toBe(200);
    return s;
  }

  async function updateToDinner(zoneId: string): Promise<void> {
    fixedAt = AFTER_LUNCH;
    const offer = (await offered(zoneId))!;
    await expectRevision(
      v,
      updateLayout(zoneId, { setId: offer.setId, layoutRevision: offer.revision }),
      zoneId,
    );
  }

  it("marks a table moved onto a place its layout overlaps with a table standing where that layout puts it", async () => {
    const { d, live } = await overlappingDinner(80);
    const partyId = await seatAt(live("two"));
    await updateToDinner(d.zoneId);
    expect(await todayRow(v, live("four"))).toMatchObject({ x: 44 });
    expect(await todayRow(v, live("two"))).toMatchObject({ x: 0 });
    await finish(partyId);
    expect(await floorToday(live("two"))).toMatchObject({ needsMoving: true });

    await expectRevision(v, today(live("two"), "mark-moved"), d.zoneId);

    expect(await todayRow(v, live("two"))).toMatchObject({ x: 40, takenOff: false });
    expect(await todayRow(v, live("four"))).toMatchObject({ x: 44, takenOff: false });
    expect(await floorToday(live("two"))).toMatchObject({ needsMoving: false });
    await seatAt(live("two"));
  });

  it("puts two free tables down overlapping as their layout has them, one already in its place", async () => {
    const { d, live } = await overlappingDinner(44);

    await updateToDinner(d.zoneId);

    expect(await todayRow(v, live("two"))).toMatchObject({ x: 40, takenOff: false });
    expect(await todayRow(v, live("four"))).toMatchObject({ x: 44, takenOff: false });
    expect(await floorToday(live("two"))).toMatchObject({ needsMoving: false });
  });

  it("still refuses Mark moved while the overlapping table stands one square off its own place", async () => {
    const { d, live } = await overlappingDinner(80);
    const partyId = await seatAt(live("two"));
    await updateToDinner(d.zoneId);
    await expectRevision(v, today(live("four"), "move", { x: 45, y: 0 }), d.zoneId);
    await finish(partyId);
    expect(await floorToday(live("two"))).toMatchObject({ needsMoving: true });

    expect(await refusal(today(live("two"), "mark-moved"))).toEqual({
      status: 409,
      body: {
        error: {
          code: "table.new_place_taken",
          params: { tableId: live("two"), standingId: live("four") },
        },
      },
    });
    expect(await todayRow(v, live("two"))).toMatchObject({ x: 0 });
  });

  it("serves Back while the overlapping table stands exactly at its own saved place", async () => {
    const { d, live } = await overlappingDinner(44);
    await updateToDinner(d.zoneId);
    await expectRevision(v, today(live("two"), "move", { x: 0, y: 0 }), d.zoneId);

    await expectRevision(v, today(live("two"), "back"), d.zoneId);

    expect(await todayRow(v, live("two"))).toMatchObject({ x: 40 });
  });

  it("refuses Back while the overlapping table stands one square off its own place", async () => {
    const { d, live } = await overlappingDinner(44);
    await updateToDinner(d.zoneId);
    await expectRevision(v, today(live("two"), "move", { x: 0, y: 0 }), d.zoneId);
    await expectRevision(v, today(live("four"), "move", { x: 45, y: 0 }), d.zoneId);

    expect(await refusal(today(live("two"), "back"))).toEqual({
      status: 409,
      body: {
        error: {
          code: "table.place_taken",
          params: { tableId: live("two"), standingId: live("four") },
        },
      },
    });
    expect(await todayRow(v, live("two"))).toMatchObject({ x: 0 });
  });
});
