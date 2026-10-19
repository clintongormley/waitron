import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, asc, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorResetTables,
  floorTodaySplitParts,
  floorTodayTables,
  joinedTableApart,
} from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { setNeedsClearingInEveryDepartment } from "./testing/needs-clearing.js";
import { readLayout, saveLayout } from "./floor-plan.js";
import { defaultLayout } from "./testing/floor-sets.js";
import { resetZone } from "./floor-today-store.js";
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
  plannedZone,
  standardAndDinner as standardAndDinnerIn,
  withFloorRevision,
  zoneRevisionOf,
} from "./testing/floor-today-venue.js";
import { seedSessionDevice } from "./testing/session-device.js";
import "./errors.js";

let v: PartyVenue;
let app: Hono;
let cookie: string;

const NOW = new Date("2026-10-10T12:00:00Z");
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
  const clock: TrustedClock = { ...v.clock, now: () => ({ ...v.clock.now(), instant: NOW }) };
  app = new Hono();
  mountTillApi(
    app,
    {
      db: v.db,
      backend: v.backend,
      clock,
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
  await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, false));
});

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(await withFloorRevision(v, path, body)) }),
  });
}

const markMoved = (tableId: string) => send("POST", `/api/tables/${tableId}/today/mark-moved`, {});
const leaveHere = (tableId: string) => send("POST", `/api/tables/${tableId}/today/leave-here`, {});
const back = (tableId: string) => send("POST", `/api/tables/${tableId}/today/back`, {});

async function refusal(answer: Promise<Response>): Promise<{ status: number; body: unknown }> {
  const settled = await answer;
  return { status: settled.status, body: await settled.json() };
}

const newPlaceTaken = (tableId: string, standingId: string) => ({
  status: 409,
  body: { error: { code: "table.new_place_taken", params: { tableId, standingId } } },
});

const placeTaken = (tableId: string, standingId: string) => ({
  status: 409,
  body: { error: { code: "table.place_taken", params: { tableId, standingId } } },
});

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

/** The till's floor read, by table. */
async function readStates() {
  const answer = await send("GET", "/api/tables/state");
  expect(answer.status).toBe(200);
  const tables = (await answer.json()) as {
    id: string;
    label: string;
    today: { needsMoving: boolean };
  }[];
  return new Map(tables.map((t) => [t.id, t]));
}

const needsMoving = async (tableId: string) => (await readStates()).get(tableId)!.today.needsMoving;

async function readyOf(tableId: string) {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ pending: floorResetTables.pending, readyToMove: floorResetTables.readyToMove })
      .from(floorResetTables)
      .where(eq(floorResetTables.tableId, tableId)),
  );
  return row;
}

async function rowStateOf(tableId: string | null, zoneId?: string) {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({
        pending: floorResetTables.pending,
        readyToMove: floorResetTables.readyToMove,
        placed: floorResetTables.placed,
      })
      .from(floorResetTables)
      .where(
        tableId === null
          ? and(isNull(floorResetTables.tableId), eq(floorResetTables.zoneId, zoneId!))
          : eq(floorResetTables.tableId, tableId),
      ),
  );
  return row;
}

async function todayRow(tableId: string) {
  const [row] = await inTx(v, (tx) =>
    tx.select().from(floorTodayTables).where(eq(floorTodayTables.tableId, tableId)),
  );
  return row;
}

const setToday = (tableId: string, values: Partial<typeof floorTodayTables.$inferInsert>) =>
  inTx(v, (tx) =>
    tx.update(floorTodayTables).set(values).where(eq(floorTodayTables.tableId, tableId)),
  );

/** Every today's row, reset row and split row, to show a refusal wrote nothing. */
async function everything() {
  return inTx(v, async (tx) => ({
    today: await tx.select().from(floorTodayTables).orderBy(asc(floorTodayTables.id)),
    reset: await tx.select().from(floorResetTables).orderBy(asc(floorResetTables.id)),
    split: await tx.select().from(floorTodaySplitParts).orderBy(asc(floorTodaySplitParts.id)),
  }));
}

async function apart(tableId: string): Promise<boolean> {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ apart: joinedTableApart(diningTables.id) })
      .from(diningTables)
      .where(eq(diningTables.id, tableId)),
  );
  return Boolean(row!.apart);
}

function fresh(label: string): string {
  return `${label} ${randomUUID().slice(0, 6)}`;
}

type Placed = { key: string; standard: number | null; dinner: number | null; partKeys?: string[] };

function standardAndDinner(tables: Placed[]) {
  return standardAndDinnerIn(
    v,
    NOW,
    tables.map((t) => ({ key: t.key, label: fresh(t.key), partKeys: t.partKeys })),
    {
      standard: Object.fromEntries(tables.map((t) => [t.key, t.standard])),
      dinner: Object.fromEntries(tables.map((t) => [t.key, t.dinner])),
    },
  );
}

/** Table 3 stands at 0 in Standard and 40 in Dinner, beside `more`; its guests leave after the reset onto Dinner. */
async function threeNeedsMoving(more: Placed[] = []) {
  const s = await standardAndDinner([{ key: "t3", standard: 0, dinner: 40 }, ...more]);
  await s.onto(s.d.standard);
  const t3 = s.live("t3");
  const partyId = await seatAt(t3);
  await s.onto(s.d.dinner);
  await finish(partyId);
  expect(await needsMoving(t3)).toBe(true);
  expect(await todayRow(t3)).toMatchObject({ x: 0 });
  return { ...s, t3 };
}

/** Dinner (4+5 at 60) recorded with guests at 4+5, then reset onto Standard (4 at 0, 5 at 20). */
async function fourPlusFiveSeatedAcrossStandard(more: Placed[] = []) {
  const s = await standardAndDinner([
    { key: "t4", standard: 0, dinner: null },
    { key: "t5", standard: 20, dinner: null },
    { key: "t45", standard: null, dinner: 60, partKeys: ["t4", "t5"] },
    ...more,
  ]);
  await s.onto(s.d.dinner);
  const [t4, t5, t45] = [s.live("t4"), s.live("t5"), s.live("t45")];
  const partyId = await seatAt(t45);
  await s.onto(s.d.standard);
  expect(await todayRow(t45)).toMatchObject({ x: 60 });
  await finish(partyId);
  expect(await needsMoving(t45)).toBe(true);
  return { ...s, t4, t5, t45 };
}

describe("Mark moved", () => {
  it("puts a table needing moving in its new place and clears its mark", async () => {
    const z = await threeNeedsMoving();
    const before = (await zoneRevisionOf(v, z.d.zoneId))!;

    await expectRevision(v, markMoved(z.t3), z.d.zoneId, before + 1);

    expect(await todayRow(z.t3)).toMatchObject({ x: 40, takenOff: false });
    expect(await readyOf(z.t3)).toEqual({ pending: false, readyToMove: false });
    expect(await needsMoving(z.t3)).toBe(false);
  });

  it("moves the whole joined group", async () => {
    const s = await standardAndDinner([
      { key: "t4", standard: 0, dinner: null },
      { key: "t5", standard: 20, dinner: null },
      { key: "t45", standard: null, dinner: 60, partKeys: ["t4", "t5"] },
    ]);
    await s.onto(s.d.standard);
    const [t4, t5, t45] = [s.live("t4"), s.live("t5"), s.live("t45")];
    const partyId = await seatAt(t4);
    await s.onto(s.d.dinner);
    await finish(partyId);
    const states = await readStates();
    expect(states.get(t4)!.today.needsMoving).toBe(true);
    expect(states.get(t5)!.today.needsMoving).toBe(true);
    expect(await todayRow(t45)).toMatchObject({ x: null });

    await expectRevision(v, markMoved(t5), s.d.zoneId);

    expect(await todayRow(t4)).toMatchObject({ x: null });
    expect(await todayRow(t5)).toMatchObject({ x: null });
    expect(await todayRow(t45)).toMatchObject({ x: 60, takenOff: false });
    for (const id of [t4, t5, t45]) {
      expect(await readyOf(id)).toEqual({ pending: false, readyToMove: false });
    }
  });

  it("takes 4+5 apart", async () => {
    const z = await fourPlusFiveSeatedAcrossStandard();

    await expectRevision(v, markMoved(z.t45), z.d.zoneId);

    expect(await todayRow(z.t45)).toMatchObject({ x: null });
    expect(await apart(z.t45)).toBe(true);
    expect(await todayRow(z.t4)).toMatchObject({ x: 0, takenOff: false });
    expect(await todayRow(z.t5)).toMatchObject({ x: 20, takenOff: false });
    await seatAt(z.t4);
    await seatAt(z.t5);
  });

  it("takes 4+5 apart is refused while a table that does not need moving stands in 4's place", async () => {
    const z = await fourPlusFiveSeatedAcrossStandard([{ key: "t8", standard: 120, dinner: 120 }]);
    const t8 = z.live("t8");
    await setToday(t8, { x: 0 });
    expect(await needsMoving(t8)).toBe(false);
    const before = await everything();

    expect(await refusal(markMoved(z.t45))).toEqual(newPlaceTaken(z.t4, t8));

    expect(await everything()).toEqual(before);
  });

  it("takes 4+5 apart keeping 4 off, taken off before the layouts changed, where nothing stands in its way", async () => {
    const s = await standardAndDinner([
      { key: "t4", standard: 0, dinner: null },
      { key: "t5", standard: 20, dinner: null },
      { key: "t45", standard: null, dinner: 60, partKeys: ["t4", "t5"] },
      { key: "t8", standard: 120, dinner: 120 },
    ]);
    await s.onto(s.d.standard);
    const [t4, t5, t45, t8] = [s.live("t4"), s.live("t5"), s.live("t45"), s.live("t8")];
    await setToday(t4, { takenOff: true });
    await s.update(s.d.dinner);
    const partyId = await seatAt(t45);
    await s.update(s.d.standard);
    await finish(partyId);
    expect(await needsMoving(t45)).toBe(true);
    expect(await todayRow(t4)).toMatchObject({ takenOff: true });
    await setToday(t8, { x: 0 });

    await expectRevision(v, markMoved(t45), s.d.zoneId);

    expect(await todayRow(t4)).toMatchObject({ x: 0, takenOff: true });
    expect(await todayRow(t5)).toMatchObject({ x: 20, takenOff: false });
    expect(await todayRow(t45)).toMatchObject({ x: null });
  });

  it("names the table pressed when the place taken is a joined table's still to be made", async () => {
    const z = await plannedZone(
      v,
      [
        { key: "c3", place: { x: 0, y: 0 } },
        { key: "c4", place: { x: 20, y: 0 } },
        { key: "t8", place: { x: 80, y: 0 } },
      ],
      NOW,
    );
    const [c3, c4, t8] = [z.table.c3!, z.table.c4!, z.table.t8!];
    const partyId = await seatAt(c3);
    await inTx(v, async (tx) => {
      const layout = await defaultLayout(tx, v.cfg, z.zoneId);
      const plan = await readLayout(tx, v.cfg, layout);
      await saveLayout(
        tx,
        v.cfg,
        REMOVALS,
        layout,
        {
          revision: plan.revision,
          tables: [
            ...plan.tables.map((t) => ({
              id: t.id,
              key: t.id,
              label: t.label,
              seats: t.seats,
              fixed: t.fixed,
              placement: t.id === z.master.t8 ? t.placement : null,
              partKeys: t.partIds,
            })),
            {
              key: "long",
              label: fresh("Long"),
              seats: 8,
              fixed: false,
              placement: { x: 0, y: 40, width: 8, height: 8, shape: "rect" as const, rotation: 0 },
              partKeys: [z.master.c3!, z.master.c4!],
            },
          ],
        },
        NOW,
      );
      await resetZone(tx, v.cfg, REMOVALS, z.zoneId, NOW, "due");
    });
    await finish(partyId);
    expect(await needsMoving(c4)).toBe(true);
    await setToday(t8, { x: 0, y: 40 });

    expect(await refusal(markMoved(c4))).toEqual(newPlaceTaken(c4, t8));
  });

  it("is refused, writing nothing, while guests sit at a part of the group with no place today", async () => {
    const z = await plannedZone(
      v,
      [
        { key: "c3", place: { x: 0, y: 0 } },
        { key: "c4", place: { x: 20, y: 0 } },
        { key: "c9", place: null },
      ],
      NOW,
    );
    const [c3, c4, c9] = [z.table.c3!, z.table.c4!, z.table.c9!];
    const partyId = await seatAt(c3);
    await inTx(v, async (tx) => {
      const layout = await defaultLayout(tx, v.cfg, z.zoneId);
      const plan = await readLayout(tx, v.cfg, layout);
      await saveLayout(
        tx,
        v.cfg,
        REMOVALS,
        layout,
        {
          revision: plan.revision,
          tables: [
            ...plan.tables.map((t) => ({
              id: t.id,
              key: t.id,
              label: t.label,
              seats: t.seats,
              fixed: t.fixed,
              placement: null,
              partKeys: t.partIds,
            })),
            {
              key: "long",
              label: fresh("Long"),
              seats: 8,
              fixed: false,
              placement: { x: 0, y: 40, width: 8, height: 8, shape: "rect" as const, rotation: 0 },
              partKeys: [z.master.c3!, z.master.c4!, z.master.c9!],
            },
          ],
        },
        NOW,
      );
      await resetZone(tx, v.cfg, REMOVALS, z.zoneId, NOW, "due");
    });
    await finish(partyId);
    expect(await needsMoving(c4)).toBe(true);
    expect(await needsMoving(c9)).toBe(false);
    await seatAt(c9);
    const before = await everything();

    expect(await refusal(markMoved(c4))).toEqual({
      status: 409,
      body: { error: { code: "tab.already_open", params: { tableId: c9 } } },
    });

    expect(await everything()).toEqual(before);
    expect(await needsMoving(c4)).toBe(true);
  });

  it("is refused while guests sit at a table of another waiting joined group tied to it by a merge", async () => {
    const z = await plannedZone(
      v,
      [
        { key: "c3", place: { x: 0, y: 0 } },
        { key: "c4", place: { x: 20, y: 0 } },
        { key: "c6", place: { x: 40, y: 0 } },
        { key: "c9", place: null },
      ],
      NOW,
    );
    const [c3, c4, c6, c9] = [z.table.c3!, z.table.c4!, z.table.c6!, z.table.c9!];
    await expectRevision(
      v,
      send("POST", `/api/tables/${c4}/today/merge`, { targetId: c6, side: "right", seats: 8 }),
    );
    const partyId = await seatAt(c3);
    const at = (x: number) => ({
      x,
      y: 40,
      width: 8,
      height: 8,
      shape: "rect" as const,
      rotation: 0,
    });
    await inTx(v, async (tx) => {
      const layout = await defaultLayout(tx, v.cfg, z.zoneId);
      const plan = await readLayout(tx, v.cfg, layout);
      await saveLayout(
        tx,
        v.cfg,
        REMOVALS,
        layout,
        {
          revision: plan.revision,
          tables: [
            ...plan.tables.map((t) => ({
              id: t.id,
              key: t.id,
              label: t.label,
              seats: t.seats,
              fixed: t.fixed,
              placement: null,
              partKeys: t.partIds,
            })),
            {
              key: "long1",
              label: fresh("Long1"),
              seats: 8,
              fixed: false,
              placement: at(0),
              partKeys: [z.master.c3!, z.master.c4!],
            },
            {
              key: "long2",
              label: fresh("Long2"),
              seats: 8,
              fixed: false,
              placement: at(40),
              partKeys: [z.master.c6!, z.master.c9!],
            },
          ],
        },
        NOW,
      );
      await resetZone(tx, v.cfg, REMOVALS, z.zoneId, NOW, "due");
    });
    await finish(partyId);
    expect(await needsMoving(c4)).toBe(true);
    await seatAt(c9);
    const before = await everything();

    expect(await refusal(markMoved(c4))).toEqual({
      status: 409,
      body: { error: { code: "tab.already_open", params: { tableId: c9 } } },
    });

    expect(await everything()).toEqual(before);
  });

  it("Back to its saved place on a table that needs moving is Mark moved", async () => {
    const z = await threeNeedsMoving();

    await expectRevision(v, back(z.t3), z.d.zoneId);

    expect(await todayRow(z.t3)).toMatchObject({ x: 40, takenOff: false });
    expect(await readyOf(z.t3)).toEqual({ pending: false, readyToMove: false });
  });

  it("Back to its saved place on a table that needs moving is refused as Mark moved is", async () => {
    const z = await threeNeedsMoving([{ key: "t8", standard: 120, dinner: 120 }]);
    const t8 = z.live("t8");
    await setToday(t8, { x: 40 });
    const before = await everything();

    expect(await refusal(back(z.t3))).toEqual(newPlaceTaken(z.t3, t8));

    expect(await everything()).toEqual(before);
  });

  it("is refused while a table that does not need moving stands in the new place", async () => {
    const z = await threeNeedsMoving([{ key: "t8", standard: 120, dinner: 120 }]);
    const t8 = z.live("t8");
    await setToday(t8, { x: 36 });
    expect(await needsMoving(t8)).toBe(false);
    const before = await everything();

    expect(await refusal(markMoved(z.t3))).toEqual(newPlaceTaken(z.t3, t8));

    expect(await everything()).toEqual(before);
    expect(await needsMoving(z.t3)).toBe(true);
  });

  it("is not blocked by a part out of service inside a joined table", async () => {
    const z = await threeNeedsMoving([
      { key: "t4", standard: 100, dinner: null },
      { key: "t5", standard: 120, dinner: null },
      { key: "t45", standard: null, dinner: 80, partKeys: ["t4", "t5"] },
    ]);
    const t4 = z.live("t4");
    await setToday(t4, { x: 40, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 });

    await expectRevision(v, markMoved(z.t3), z.d.zoneId);

    expect(await todayRow(z.t3)).toMatchObject({ x: 40 });
    expect(await readyOf(z.t3)).toEqual({ pending: false, readyToMove: false });
  });

  it("is not blocked by a table that itself needs moving", async () => {
    const s = await standardAndDinner([
      { key: "t2", standard: 0, dinner: 40 },
      { key: "t3", standard: 40, dinner: 0 },
    ]);
    await s.onto(s.d.standard);
    const [t2, t3] = [s.live("t2"), s.live("t3")];
    const party2 = await seatAt(t2);
    const party3 = await seatAt(t3);
    await s.onto(s.d.dinner);
    await finish(party2);
    await finish(party3);
    expect(await needsMoving(t2)).toBe(true);
    expect(await needsMoving(t3)).toBe(true);

    await expectRevision(v, markMoved(t2), s.d.zoneId);

    expect(await todayRow(t2)).toMatchObject({ x: 40 });
    expect(await todayRow(t3)).toMatchObject({ x: 40 });
    expect(await needsMoving(t2)).toBe(false);
    expect(await needsMoving(t3)).toBe(true);

    await expectRevision(v, markMoved(t3), s.d.zoneId);

    expect(await todayRow(t3)).toMatchObject({ x: 0 });
    expect(await readyOf(t2)).toEqual({ pending: false, readyToMove: false });
    expect(await readyOf(t3)).toEqual({ pending: false, readyToMove: false });
  });

  it("changes nothing on a table that does not need moving", async () => {
    const { zoneId, table } = await plannedZone(v, [{ key: "a", place: { x: 0, y: 0 } }], NOW);
    await setToday(table.a!, { x: 30 });
    const read = (await zoneRevisionOf(v, zoneId))!;
    const before = await everything();

    await expectRevision(v, markMoved(table.a!), zoneId, read);

    expect(await everything()).toEqual(before);
  });

  it("applies a marked table's new name with its move", async () => {
    const { zoneId, table, master, revision } = await plannedZone(
      v,
      [{ key: "a", place: { x: 0, y: 0 } }],
      NOW,
    );
    const partyId = await seatAt(table.a!);
    const renamed = fresh("Renamed");
    await inTx(v, async (tx) => {
      const layout = await defaultLayout(tx, v.cfg, zoneId);
      const plan = await readLayout(tx, v.cfg, layout);
      const saved = plan.tables.find((t) => t.id === master.a)!;
      await saveLayout(
        tx,
        v.cfg,
        REMOVALS,
        layout,
        {
          revision,
          tables: [
            {
              id: saved.id,
              key: "a",
              label: renamed,
              seats: saved.seats,
              fixed: saved.fixed,
              placement: { ...saved.placement!, x: 40 },
              partKeys: [],
            },
          ],
        },
        NOW,
      );
      await resetZone(tx, v.cfg, REMOVALS, zoneId, NOW, "due");
    });
    await finish(partyId);
    expect(await needsMoving(table.a!)).toBe(true);
    expect((await tableRow(v, table.a!)).label).not.toBe(renamed);

    await expectRevision(v, markMoved(table.a!), zoneId);

    expect((await tableRow(v, table.a!)).label).toBe(renamed);
    expect(await todayRow(table.a!)).toMatchObject({ x: 40 });
  });
});

describe("Leave it here", () => {
  const ended = { pending: false, readyToMove: false, placed: true };

  /** Table 3 needs moving and table 8 stands in its new place, so Mark moved is refused. */
  async function threeBlocked(more: Placed[] = []) {
    const z = await threeNeedsMoving([{ key: "t8", standard: 120, dinner: 120 }, ...more]);
    const t8 = z.live("t8");
    await setToday(t8, { x: 36 });
    expect(await refusal(markMoved(z.t3))).toEqual(newPlaceTaken(z.t3, t8));
    return { ...z, t8 };
  }

  /**
   * c3 and c4 (and any others in `entries`) joined by a new layout as a joined table still to be
   * made at (0, 40); `kept` keeps its place, the rest go off the map. c3's guests leave after the
   * reset.
   */
  async function joinedStillToBeMade(
    entries: { key: string; place: { x: number; y: number } | null }[],
    parts: string[],
    kept: string[],
  ) {
    const z = await plannedZone(v, entries, NOW);
    const partyId = await seatAt(z.table.c3!);
    await inTx(v, async (tx) => {
      const layout = await defaultLayout(tx, v.cfg, z.zoneId);
      const plan = await readLayout(tx, v.cfg, layout);
      await saveLayout(
        tx,
        v.cfg,
        REMOVALS,
        layout,
        {
          revision: plan.revision,
          tables: [
            ...plan.tables.map((t) => ({
              id: t.id,
              key: t.id,
              label: t.label,
              seats: t.seats,
              fixed: t.fixed,
              placement: kept.some((key) => z.master[key] === t.id) ? t.placement : null,
              partKeys: t.partIds,
            })),
            {
              key: "long",
              label: fresh("Long"),
              seats: 8,
              fixed: false,
              placement: { x: 0, y: 40, width: 8, height: 8, shape: "rect" as const, rotation: 0 },
              partKeys: parts.map((key) => z.master[key]!),
            },
          ],
        },
        NOW,
      );
      await resetZone(tx, v.cfg, REMOVALS, z.zoneId, NOW, "due");
    });
    await finish(partyId);
    expect(await needsMoving(z.table.c4!)).toBe(true);
    return z;
  }

  it("leaves a table whose Mark moved was refused where it stands, seatable, and the saved layout unchanged", async () => {
    const z = await threeBlocked();
    const saved = await inTx(v, (tx) =>
      readLayout(tx, v.cfg, { setId: z.d.dinner, zoneId: z.d.zoneId }),
    );
    const before = (await zoneRevisionOf(v, z.d.zoneId))!;

    await expectRevision(v, leaveHere(z.t3), z.d.zoneId, before + 1);

    expect(await todayRow(z.t3)).toMatchObject({ x: 0, takenOff: false });
    expect(await needsMoving(z.t3)).toBe(false);
    expect(await rowStateOf(z.t3)).toEqual(ended);
    expect(
      await inTx(v, (tx) => readLayout(tx, v.cfg, { setId: z.d.dinner, zoneId: z.d.zoneId })),
    ).toEqual(saved);
    await seatAt(z.t3);
  });

  it("a later read does not mark it again, even once the table in its way has gone", async () => {
    const z = await threeBlocked();
    await expectRevision(v, leaveHere(z.t3), z.d.zoneId);
    await setToday(z.t8, { x: 120 });

    for (let read = 0; read < 2; read++) {
      expect((await readStates()).get(z.t3)!.today.needsMoving).toBe(false);
      expect(await todayRow(z.t3)).toMatchObject({ x: 0 });
    }
  });

  it("the next reset tries again, and marks it while a table with guests stands in its new place", async () => {
    const z = await threeBlocked();
    await expectRevision(v, leaveHere(z.t3), z.d.zoneId);
    await setToday(z.t8, { x: 36 });
    await seatAt(z.t8);

    await z.onto(z.d.dinner);

    expect(await needsMoving(z.t3)).toBe(true);
    expect(await rowStateOf(z.t3)).toEqual({ pending: true, readyToMove: true, placed: false });
    expect(await todayRow(z.t3)).toMatchObject({ x: 0 });
  });

  it("the next reset with nothing in its way puts it in its new place", async () => {
    const z = await threeBlocked();
    await expectRevision(v, leaveHere(z.t3), z.d.zoneId);
    await setToday(z.t8, { x: 120 });

    await z.onto(z.d.dinner);

    expect(await todayRow(z.t3)).toMatchObject({ x: 40 });
    expect(await needsMoving(z.t3)).toBe(false);
  });

  it("is joinable once left", async () => {
    const z = await threeBlocked([{ key: "t5", standard: 80, dinner: 80 }]);
    const t5 = z.live("t5");
    await expectRevision(v, leaveHere(z.t3), z.d.zoneId);

    await expectRevision(
      v,
      send("POST", `/api/tables/${t5}/today/merge`, { targetId: z.t3, side: "right", seats: 8 }),
      z.d.zoneId,
    );
  });

  it("leaves the whole joined group: 4 and 5 stay apart and 4+5 off the map", async () => {
    const s = await standardAndDinner([
      { key: "t4", standard: 0, dinner: null },
      { key: "t5", standard: 20, dinner: null },
      { key: "t45", standard: null, dinner: 60, partKeys: ["t4", "t5"] },
    ]);
    await s.onto(s.d.standard);
    const [t4, t5, t45] = [s.live("t4"), s.live("t5"), s.live("t45")];
    const partyId = await seatAt(t4);
    await s.onto(s.d.dinner);
    await finish(partyId);
    expect(await needsMoving(t5)).toBe(true);

    await expectRevision(v, leaveHere(t5), s.d.zoneId);

    expect(await todayRow(t4)).toMatchObject({ x: 0 });
    expect(await todayRow(t5)).toMatchObject({ x: 20 });
    expect(await todayRow(t45)).toMatchObject({ x: null });
    for (const id of [t4, t5, t45]) expect(await rowStateOf(id)).toEqual(ended);
    await seatAt(t4);
    await seatAt(t5);
  });

  it("leaves 4+5 standing joined and seatable", async () => {
    const z = await fourPlusFiveSeatedAcrossStandard();

    await expectRevision(v, leaveHere(z.t45), z.d.zoneId);

    expect(await todayRow(z.t45)).toMatchObject({ x: 60 });
    expect(await needsMoving(z.t45)).toBe(false);
    expect(await todayRow(z.t4)).toMatchObject({ x: null });
    expect(await todayRow(z.t5)).toMatchObject({ x: null });
    await seatAt(z.t45);
    const atFour = await send("POST", `/api/tables/${z.t4}/seat`, {});
    expect(atFour.status).toBe(409);
    expect(((await atFour.json()) as { error: { code: string } }).error.code).toBe(
      "table.in_joined_table",
    );
  });

  it("ends the row of a joined table still to be made, which is not made later", async () => {
    const z = await joinedStillToBeMade(
      [
        { key: "c3", place: { x: 0, y: 0 } },
        { key: "c4", place: { x: 20, y: 0 } },
        { key: "t8", place: { x: 80, y: 0 } },
      ],
      ["c3", "c4"],
      ["t8"],
    );
    const [c3, c4, t8] = [z.table.c3!, z.table.c4!, z.table.t8!];
    await setToday(t8, { x: 0, y: 40 });
    const tablesIn = async () =>
      (
        await inTx(v, (tx) =>
          tx.select().from(diningTables).where(eq(diningTables.zoneId, z.zoneId)),
        )
      ).length;
    const count = await tablesIn();

    await expectRevision(v, leaveHere(c4), z.zoneId);
    await setToday(t8, { x: 80, y: 0 });
    await readStates();

    expect(await tablesIn()).toBe(count);
    expect(await needsMoving(c4)).toBe(false);
    expect(await needsMoving(c3)).toBe(false);
    expect(await rowStateOf(null, z.zoneId)).toMatchObject({ pending: false });
    await seatAt(c4);
  });

  it("keeps a rename the dashboard gave it, and its place", async () => {
    const { zoneId, table, master, revision } = await plannedZone(
      v,
      [{ key: "a", place: { x: 0, y: 0 } }],
      NOW,
    );
    const partyId = await seatAt(table.a!);
    const renamed = fresh("Renamed");
    await inTx(v, async (tx) => {
      const layout = await defaultLayout(tx, v.cfg, zoneId);
      const plan = await readLayout(tx, v.cfg, layout);
      const saved = plan.tables.find((t) => t.id === master.a)!;
      await saveLayout(
        tx,
        v.cfg,
        REMOVALS,
        layout,
        {
          revision,
          tables: [
            {
              id: saved.id,
              key: "a",
              label: renamed,
              seats: saved.seats,
              fixed: saved.fixed,
              placement: { ...saved.placement!, x: 40 },
              partKeys: [],
            },
          ],
        },
        NOW,
      );
      await resetZone(tx, v.cfg, REMOVALS, zoneId, NOW, "due");
    });
    await finish(partyId);
    expect(await needsMoving(table.a!)).toBe(true);

    await expectRevision(v, leaveHere(table.a!), zoneId);

    expect((await tableRow(v, table.a!)).label).toBe(renamed);
    expect(await todayRow(table.a!)).toMatchObject({ x: 0 });
    expect(await rowStateOf(table.a!)).toEqual(ended);
  });

  it("keeps its place and old name while a rename to a name another zone holds waits", async () => {
    const elsewhere = await plannedZone(v, [{ key: "b", place: { x: 0, y: 0 } }], NOW);
    const heldName = (await tableRow(v, elsewhere.table.b!)).label;
    const { zoneId, table, master, revision } = await plannedZone(
      v,
      [{ key: "a", place: { x: 0, y: 0 } }],
      NOW,
    );
    const oldName = (await tableRow(v, table.a!)).label;
    const partyId = await seatAt(table.a!);
    await inTx(v, async (tx) => {
      const layout = await defaultLayout(tx, v.cfg, zoneId);
      const plan = await readLayout(tx, v.cfg, layout);
      const saved = plan.tables.find((t) => t.id === master.a)!;
      await saveLayout(
        tx,
        v.cfg,
        REMOVALS,
        layout,
        {
          revision,
          tables: [
            {
              id: saved.id,
              key: "a",
              label: fresh("Renamed"),
              seats: saved.seats,
              fixed: saved.fixed,
              placement: { ...saved.placement!, x: 40 },
              partKeys: [],
            },
          ],
        },
        NOW,
      );
      await resetZone(tx, v.cfg, REMOVALS, zoneId, NOW, "due");
    });
    await finish(partyId);
    expect(await needsMoving(table.a!)).toBe(true);
    await inTx(v, (tx) =>
      tx
        .update(floorResetTables)
        .set({ label: heldName })
        .where(eq(floorResetTables.tableId, table.a!)),
    );

    await expectRevision(v, leaveHere(table.a!), zoneId);

    for (let read = 0; read < 2; read++) {
      expect(await needsMoving(table.a!)).toBe(false);
      expect(await rowStateOf(table.a!)).toEqual({
        pending: true,
        readyToMove: false,
        placed: true,
      });
      expect(await todayRow(table.a!)).toMatchObject({ x: 0 });
      expect((await tableRow(v, table.a!)).label).toBe(oldName);
    }
  });

  it("after Leave it here on 2 of a swap, Mark moved on 3 is refused naming 2, and 3 can be left too", async () => {
    const s = await standardAndDinner([
      { key: "t2", standard: 0, dinner: 40 },
      { key: "t3", standard: 40, dinner: 0 },
    ]);
    await s.onto(s.d.standard);
    const [t2, t3] = [s.live("t2"), s.live("t3")];
    const party2 = await seatAt(t2);
    const party3 = await seatAt(t3);
    await s.onto(s.d.dinner);
    await finish(party2);
    await finish(party3);
    expect(await needsMoving(t2)).toBe(true);
    expect(await needsMoving(t3)).toBe(true);

    await expectRevision(v, leaveHere(t2), s.d.zoneId);
    expect(await refusal(markMoved(t3))).toEqual(newPlaceTaken(t3, t2));
    await expectRevision(v, leaveHere(t3), s.d.zoneId);

    expect(await todayRow(t2)).toMatchObject({ x: 0 });
    expect(await todayRow(t3)).toMatchObject({ x: 40 });
    expect(await needsMoving(t2)).toBe(false);
    expect(await needsMoving(t3)).toBe(false);
  });

  it("changes nothing on a table that does not need moving", async () => {
    const { zoneId, table } = await plannedZone(v, [{ key: "a", place: { x: 0, y: 0 } }], NOW);
    await setToday(table.a!, { x: 30 });
    const read = (await zoneRevisionOf(v, zoneId))!;
    const before = await everything();

    await expectRevision(v, leaveHere(table.a!), zoneId, read);

    expect(await everything()).toEqual(before);
  });

  it("is refused, writing nothing, when the room has moved on", async () => {
    const z = await threeNeedsMoving();
    const before = (await zoneRevisionOf(v, z.d.zoneId))!;
    const rows = await everything();

    const answer = await refusal(
      send("POST", `/api/tables/${z.t3}/today/leave-here`, { zoneRevision: before - 1 }),
    );

    expect(answer.status).toBe(409);
    expect((answer.body as { error: { code: string } }).error.code).toBe("floor_today.out_of_date");
    expect(await everything()).toEqual(rows);
    expect(await needsMoving(z.t3)).toBe(true);
  });

  it("ends the row of a group member that has guests, so floor reads do not keep running the catch-up", async () => {
    const z = await joinedStillToBeMade(
      [
        { key: "c3", place: { x: 0, y: 0 } },
        { key: "c4", place: { x: 20, y: 0 } },
        { key: "c9", place: null },
      ],
      ["c3", "c4", "c9"],
      [],
    );
    const [c3, c4, c9] = [z.table.c3!, z.table.c4!, z.table.c9!];
    expect(await needsMoving(c9)).toBe(false);
    await seatAt(c9);

    await expectRevision(v, leaveHere(c4), z.zoneId);

    for (const id of [c9, c3, c4]) expect(await rowStateOf(id)).toEqual(ended);
  });
});

describe("Back to its saved place checks what stands there", () => {
  const move = (tableId: string, x: number, y: number) =>
    send("POST", `/api/tables/${tableId}/today/move`, { x, y });

  /** Table 3 marked moved into its new place at 40, then dragged back to 0; table 8 at 120. */
  async function threeDraggedOff() {
    const z = await threeNeedsMoving([{ key: "t8", standard: 120, dinner: 120 }]);
    const t8 = z.live("t8");
    await expectRevision(v, markMoved(z.t3), z.d.zoneId);
    expect(await todayRow(z.t3)).toMatchObject({ x: 40 });
    await expectRevision(v, move(z.t3, 0, 0), z.d.zoneId);
    return { ...z, t8 };
  }

  it("after Leave it here, Back is refused while the table that blocked it stands there", async () => {
    const z = await threeNeedsMoving([{ key: "t8", standard: 120, dinner: 120 }]);
    const t8 = z.live("t8");
    await setToday(t8, { x: 36 });
    expect(await refusal(markMoved(z.t3))).toEqual(newPlaceTaken(z.t3, t8));
    await expectRevision(v, leaveHere(z.t3), z.d.zoneId);
    const before = await everything();

    expect(await refusal(back(z.t3))).toEqual(placeTaken(z.t3, t8));

    expect(await everything()).toEqual(before);
  });

  it("Back after an ordinary drag is refused while another table stands in the saved place", async () => {
    const z = await threeDraggedOff();
    await expectRevision(v, move(z.t8, 36, 0), z.d.zoneId);
    const before = await everything();

    expect(await refusal(back(z.t3))).toEqual(placeTaken(z.t3, z.t8));

    expect(await everything()).toEqual(before);
  });

  it("Back is still served when nothing stands in the saved place", async () => {
    const z = await threeDraggedOff();

    await expectRevision(v, back(z.t3), z.d.zoneId);

    expect(await todayRow(z.t3)).toMatchObject({ x: 40 });
  });
});
