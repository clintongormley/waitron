import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { diningTables, floorTodayTables, floorTodayZones, locations } from "@waitron/db";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { inTx, seat, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { mergeOf, plannedZone, resaveMaster, todayRow } from "./testing/floor-today-venue.js";
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

async function today(tableId: string, change: string, body: unknown = {}): Promise<Response> {
  return app.request(`/api/tables/${tableId}/today/${change}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

async function expect204(answer: Promise<Response>): Promise<void> {
  const settled = await answer;
  expect(settled.status, await settled.clone().text()).toBe(204);
}

async function refusal(answer: Promise<Response>): Promise<{ status: number; body: unknown }> {
  const settled = await answer;
  return { status: settled.status, body: await settled.json() };
}

interface FloorToday {
  placement: { x: number; y: number; rotation: number } | null;
  joinId: string | null;
  joinSeats: number | null;
}

async function floorToday(tableId: string): Promise<FloorToday> {
  const answer = await app.request("/api/tables/state", { headers: { cookie } });
  expect(answer.status).toBe(200);
  const tables = (await answer.json()) as { id: string; today: FloorToday }[];
  return tables.find((t) => t.id === tableId)!.today;
}

/** A at (0, 0) and B at (20, 0), both 8 × 8 and free. */
async function twoTables(joins: { seats: number; keys: string[] }[] = [], now?: Date) {
  const { table, zoneId, master } = await plannedZone(
    v,
    [
      { key: "a", place: { x: 0, y: 0 } },
      { key: "b", place: { x: 20, y: 0 } },
    ],
    joins,
    now,
  );
  return { a: table.a!, b: table.b!, zoneId, master };
}

describe("merging and splitting free tables", () => {
  it("merges two free tables and splits them back", async () => {
    const { a, b } = await twoTables();

    await expect204(today(a, "merge", { targetId: b, side: "right", seats: 8 }));

    const [atA, atB] = [await floorToday(a), await floorToday(b)];
    expect(atA.joinId).not.toBeNull();
    expect(atA).toMatchObject({ joinId: atB.joinId, joinSeats: 8 });
    expect(atB).toMatchObject({ joinSeats: 8, placement: { x: 20, y: 0, rotation: 0 } });
    expect(atA.placement).toMatchObject({ x: 28, y: 0, rotation: 0 });

    await expect204(today(a, "split"));

    expect(await floorToday(a)).toMatchObject({
      joinId: null,
      joinSeats: null,
      placement: { x: 0, y: 0, rotation: 0 },
    });
    expect(await floorToday(b)).toMatchObject({
      joinId: null,
      placement: { x: 20, y: 0, rotation: 0 },
    });
  });

  it("splits a merge from either member, and leaves a table in no merge alone", async () => {
    const { a, b } = await twoTables();
    await expect204(today(a, "merge", { targetId: b, side: "bottom", seats: 6 }));

    await expect204(today(b, "split"));
    expect(await mergeOf(v, a)).toBeNull();
    expect((await floorToday(a)).placement).toMatchObject({ x: 0, y: 0 });

    const before = await todayRow(v, a);
    await expect204(today(a, "split"));
    expect(await todayRow(v, a)).toEqual(before);
  });

  it("asks for seats when no saved join has exactly these tables", async () => {
    const unsaved = await twoTables();
    expect(
      await refusal(today(unsaved.a, "merge", { targetId: unsaved.b, side: "right" })),
    ).toEqual({
      status: 400,
      body: { error: { code: "floor_plan.invalid", params: { field: "seats" } } },
    });
    expect(await mergeOf(v, unsaved.a)).toBeNull();

    const saved = await twoTables([{ seats: 10, keys: ["a", "b"] }]);
    await expect204(today(saved.a, "merge", { targetId: saved.b, side: "right" }));
    expect(await floorToday(saved.a)).toMatchObject({ joinSeats: 10 });
  });

  it("a join saved in the editor waits for the next reset", async () => {
    // The app's clock, so the routes' catch-up falls on the same business day and resets nothing.
    const now = v.clock.now().instant;
    const { a, b, zoneId, master } = await twoTables([], now);
    await resaveMaster(
      v,
      zoneId,
      { joins: [{ seats: 6, masterIds: [master.a!, master.b!] }] },
      now,
    );
    const generation = async () => {
      const [row] = await inTx(v, (tx) =>
        tx
          .select({ generation: floorTodayZones.generation })
          .from(floorTodayZones)
          .where(eq(floorTodayZones.zoneId, zoneId)),
      );
      return row!.generation;
    };
    const built = await generation();

    expect(await refusal(today(a, "merge", { targetId: b, side: "right" }))).toEqual({
      status: 400,
      body: { error: { code: "floor_plan.invalid", params: { field: "seats" } } },
    });
    expect(await mergeOf(v, a)).toBeNull();
    expect(await generation()).toBe(built);

    const reset = await app.request(`/api/zones/${zoneId}/today/reset`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}",
    });
    expect(reset.status, await reset.clone().text()).toBe(204);
    await expect204(today(a, "merge", { targetId: b, side: "right" }));
    expect(await floorToday(a)).toMatchObject({ joinSeats: 6 });
  });

  it("refuses to merge a seated table or one needing clearing, and to split a seated merge here", async () => {
    const seated = await twoTables();
    await seat(v, seated.b);
    expect(
      await refusal(today(seated.a, "merge", { targetId: seated.b, side: "right", seats: 8 })),
    ).toEqual({
      status: 409,
      body: { error: { code: "tab.already_open", params: { tableId: seated.b } } },
    });

    const clearing = await twoTables();
    await inTx(v, (tx) =>
      tx
        .update(diningTables)
        .set({ needsClearingSince: new Date().toISOString() })
        .where(eq(diningTables.id, clearing.a)),
    );
    expect(
      await refusal(today(clearing.a, "merge", { targetId: clearing.b, side: "right", seats: 8 })),
    ).toEqual({
      status: 409,
      body: { error: { code: "table.needs_clearing", params: { tableId: clearing.a } } },
    });

    // Merged both ways round, so one of the two merges records its members out of id order.
    for (const flip of [false, true]) {
      const held = await twoTables();
      const [moving, target] = flip ? [held.b, held.a] : [held.a, held.b];
      await expect204(today(moving, "merge", { targetId: target, side: "right", seats: 8 }));
      await seat(v, held.b);
      const before = await todayRow(v, held.a);
      const [first] = [held.a, held.b].sort();
      for (const member of [held.a, held.b]) {
        expect(await refusal(today(member, "split"))).toEqual({
          status: 409,
          body: { error: { code: "tab.already_open", params: { tableId: first } } },
        });
      }
      expect(await mergeOf(v, held.a)).not.toBeNull();
      expect(await todayRow(v, held.a)).toEqual(before);
    }
  });

  it("refuses a malformed merge", async () => {
    const { a, b } = await twoTables();

    for (const body of [{ side: "right" }, { targetId: null, side: "right" }]) {
      expect(await refusal(today(a, "merge", body))).toEqual({
        status: 400,
        body: { error: { code: "management.request_invalid", params: { field: "targetId" } } },
      });
    }
    expect(await refusal(today(a, "merge", { targetId: "nope", side: "right" }))).toEqual({
      status: 404,
      body: { error: { code: "table.not_found", params: { tableId: "nope" } } },
    });
    expect(
      await refusal(today(a, "merge", { targetId: a.toUpperCase(), side: "right", seats: 8 })),
    ).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "targetId" } } },
    });
    expect(await refusal(today(a, "merge", { targetId: b, side: "up", seats: 8 }))).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "side" } } },
    });
    for (const seats of [0, 1000, 2.5, null, "8"]) {
      expect(await refusal(today(a, "merge", { targetId: b, side: "right", seats }))).toEqual({
        status: 400,
        body: { error: { code: "management.request_invalid", params: { field: "seats" } } },
      });
    }
    const { table } = await plannedZone(v, [{ key: "a" }]);
    const never = await v.table(`Never ${randomUUID().slice(0, 6)}`, await zoneOfTable(table.a!));
    expect(await todayRow(v, never)).toBeUndefined();
    expect(await refusal(today(never, "split"))).toEqual({
      status: 409,
      body: { error: { code: "table.not_in_floor_plan", params: { tableId: never } } },
    });
    expect(await refusal(today("not-a-uuid", "split"))).toMatchObject({
      status: 404,
      body: { error: { code: "table.not_found" } },
    });
    expect(await mergeOf(v, a)).toBeNull();
  });

  it("refuses another venue's table as not found, either way, and changes nothing", async () => {
    const { a } = await twoTables();
    const elsewhere = randomUUID();
    const other = randomUUID();
    await inTx(v, async (tx) => {
      await tx.insert(locations).values({
        id: elsewhere,
        name: "Other",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurant",
      });
      await tx
        .insert(diningTables)
        .values({ id: other, locationId: elsewhere, label: `Elsewhere ${other.slice(0, 6)}` });
      await tx.insert(floorTodayTables).values({
        tableId: other,
        seats: 4,
        x: 40,
        y: 0,
        width: 8,
        height: 8,
        shape: "rect",
        rotation: 0,
      });
    });
    const [beforeA, beforeOther] = [await todayRow(v, a), await todayRow(v, other)];

    expect(await refusal(today(a, "merge", { targetId: other, side: "right", seats: 8 }))).toEqual({
      status: 404,
      body: { error: { code: "table.not_found", params: { tableId: other } } },
    });
    expect(await refusal(today(other, "merge", { targetId: a, side: "right", seats: 8 }))).toEqual({
      status: 404,
      body: { error: { code: "table.not_found", params: { tableId: other } } },
    });
    expect(await refusal(today(other, "split"))).toEqual({
      status: 404,
      body: { error: { code: "table.not_found", params: { tableId: other } } },
    });
    expect(await todayRow(v, a)).toEqual(beforeA);
    expect(await todayRow(v, other)).toEqual(beforeOther);
    expect(await mergeOf(v, a)).toBeNull();
  });
});

async function zoneOfTable(tableId: string): Promise<string> {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ zoneId: diningTables.zoneId })
      .from(diningTables)
      .where(eq(diningTables.id, tableId)),
  );
  return row!.zoneId!;
}
