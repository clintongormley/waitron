import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { asc, sql, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  tableInService,
  diningTables,
  floorPlans,
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodaySplitParts,
  floorTodayTables,
  floorTodayZones,
  floorZones,
  locations,
  partyTables,
} from "@waitron/db";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { saveZonePlan } from "./floor-plan.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";

import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import {
  inTx,
  revisionOf,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  expectRevision,
  giveKeptSize,
  plannedZone,
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
      clock: v.clock,
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
    await inTx(v, (tx) =>
      saveZonePlan(tx, v.cfg, REMOVALS, zoneId, {
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

  it("resets a zone to the saved plan", async () => {
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

  it("a change sent from a read after the catch-up is applied, and survives the next read", async () => {
    const { zoneId, table, master, revision } = await plannedZone(v, [
      { key: "t", label: "T", place: { x: 0, y: 0 } },
    ]);
    const partyId = await seatAt(table.t!);
    const label = (await tableRow(v, table.t!)).label;
    await inTx(v, (tx) =>
      saveZonePlan(tx, v.cfg, REMOVALS, zoneId, {
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
    expect(read.placement).toMatchObject({ x: 50, y: 0 });
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
      await tx.insert(floorPlans).values({ zoneId, savedAt: "2026-01-01T00:00:00.000Z" });
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
        await tx.delete(floorZones).where(eq(floorZones.id, zoneId));
        await tx.delete(locations).where(eq(locations.id, elsewhere));
      });
    }
  });

  it("leaves a zone with no master plan alone on a reset", async () => {
    const zoneId = await tableServiceZone(v);
    await v.table(`Unplanned ${randomUUID().slice(0, 6)}`, zoneId);

    await expectRevision(v, resetZoneToday(zoneId), zoneId, 0);

    expect(await zoneRevisionOf(v, zoneId)).toBeUndefined();
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
    await inTx(v, (tx) =>
      saveZonePlan(tx, v.cfg, REMOVALS, zoneId, {
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
  it("says whether each zone has a saved plan, tables or none", async () => {
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
      false,
    ]);
  });
});

async function inService(tableId: string): Promise<boolean> {
  const [table] = await inTx(v, (tx) =>
    tx
      .select({ inService: tableInService(diningTables.id).mapWith(Boolean) })
      .from(diningTables)
      .where(eq(diningTables.id, tableId)),
  );
  return table!.inService;
}
