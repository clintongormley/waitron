import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { seedBusinessDay } from "@waitron/db/testing/seed.js";
import { floorLabelSuffix } from "./testing/floor-label.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { oneBill, observedTableActionBody } from "./testing/table-action-fixture.js";
import { observedClosingBody } from "./testing/party-close-fixture.js";
import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorResetTables,
  floorZones,
  withTransaction,
  workingOrders,
  todayColumns,
  todaySet,
  OFF_FLOOR,
} from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { hashPin, loginWithPin } from "@waitron/identity";
import { readLayout, saveLayout, type ZonePlanSave } from "./floor-plan.js";
import { defaultLayout } from "./testing/floor-sets.js";
import { catchUpDue, resetZone } from "./floor-today-store.js";
import { splitOff } from "./floor-today-split-group.js";
import { writeMerge } from "./floor-today-merges.js";
import { setNeedsClearingInEveryDepartment } from "./testing/needs-clearing.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import {
  counterOrder,
  inTx,
  pay,
  revisionOf,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  expectRevision,
  mergeOf,
  giveKeptSize,
  plannedZone,
  standardAndDinner as standardAndDinnerIn,
  tableServiceZone,
  withFloorRevision,
  zoneRevisionOf,
} from "./testing/floor-today-venue.js";
import { seedSessionDevice, sessionCookieForTest } from "./testing/session-device.js";
import { handOverOrder } from "./working-order.js";
import "./errors.js";

let v: PartyVenue;
let app: Hono;
let cookie: string;

const NOW = new Date("2026-10-10T12:00:00Z");
const REMOVALS = enabledTableRemovals(ALL_MODULES);
let clockAt = NOW;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

beforeAll(async () => {
  const clock: TrustedClock = {
    ...v.clock,
    now: () => ({ ...v.clock.now(), instant: clockAt }),
  };
  app = new Hono();
  mountTillApi(
    app,
    {
      admission: testTradingAdmission(),
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
  const deviceId = await seedSessionDevice(v.db);
  const session = await inTx(v, async (tx) => {
    const [person] = await seedPersons(tx, {
      displayName: "Anna",
      pinHash: hashPin("5555"),
      role: "staff",
    });
    return loginWithPin(tx, { deviceId, personId: person!.id, pin: "5555" });
  });
  cookie = await sessionCookieForTest(v.db, session.token);
});

/** A request; a change to today's floor carries the room's revision unless the body names one. */
async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(
            await observedTableActionBody(
              v.db,
              path,
              await observedClosingBody(v.db, path, await withFloorRevision(v, path, body)),
            ),
          ),
        }),
  });
}

/** The till's floor read; answers the tables it lists. */
async function readFloor(): Promise<{ id: string; label: string }[]> {
  const answer = await send("GET", "/api/tables/state");
  expect(answer.status).toBe(200);
  return (await answer.json()) as { id: string; label: string }[];
}

/** Each table the till's floor read lists, with the joined table it names, if any. */
async function readJoined(): Promise<Map<string, string | null>> {
  const answer = await send("GET", "/api/tables/state");
  expect(answer.status).toBe(200);
  const tables = (await answer.json()) as { id: string; today: { joinName: string | null } }[];
  return new Map(tables.map((t) => [t.id, t.today.joinName ?? null]));
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

/** A fresh table-service zone, so one case's plans never meet another's. */
function zone(): Promise<string> {
  return tableServiceZone(v);
}

/** A label no other case uses: names are unique across the venue. */
function fresh(label: string): string {
  return `${label} ${floorLabelSuffix()}`;
}

type Entry = ZonePlanSave["tables"][number];

function entry(key: string, label: string, extra: Partial<Entry> = {}): Entry {
  return { key, label, seats: 4, fixed: false, placement: place(0, 0), partKeys: [], ...extra };
}

function place(x: number, y: number) {
  return { x, y, width: 8, height: 8, shape: "rect" as const, rotation: 0 };
}

function save(zoneId: string, revision: number, tables: Entry[]) {
  return inTx(v, async (tx) =>
    saveLayout(tx, REMOVALS, await defaultLayout(tx, v.cfg, zoneId), { revision, tables }, NOW),
  );
}

const reset = (zoneId: string) => inTx(v, (tx) => resetZone(tx, REMOVALS, zoneId, NOW, "due"));

async function todayRow(tableId: string) {
  const [row] = await inTx(v, (tx) =>
    tx
      .select(todayColumns)
      .from(diningTables)
      .where(and(eq(diningTables.onFloor, true), eq(diningTables.id, tableId))),
  );
  return row;
}

async function moveToday(tableId: string, x: number): Promise<void> {
  await inTx(v, (tx) =>
    tx.update(diningTables).set(todaySet({ x })).where(eq(diningTables.id, tableId)),
  );
}

async function tableExists(tableId: string): Promise<boolean> {
  const rows = await inTx(v, (tx) =>
    tx.select({ id: diningTables.id }).from(diningTables).where(eq(diningTables.id, tableId)),
  );
  return rows.length > 0;
}

/** A zone whose first saved master holds one live table; answers both ids. */
async function plannedTable(label: string) {
  const zoneId = await zone();
  const { revision, ids } = await save(zoneId, 0, [entry("t", label)]);
  const plan = await inTx(v, async (tx) => readLayout(tx, await defaultLayout(tx, v.cfg, zoneId)));
  const tableId = plan.tables.find((t) => t.id === ids.t)!.liveTableId!;
  return { zoneId, tableId, masterId: ids.t!, revision };
}

describe("the till's floor routes catch today's plan up", () => {
  it("leaves a table where it stands, needing moving, on the first floor read after its party finishes", async () => {
    const label = fresh("T1");
    const { zoneId, tableId, masterId, revision } = await plannedTable(label);
    const partyId = await seatAt(tableId);
    await moveToday(tableId, 30);
    await save(zoneId, revision, [entry("t", label, { id: masterId, placement: place(50, 0) })]);
    await reset(zoneId);
    expect(await todayRow(tableId)).toMatchObject({ x: 30 });

    await finish(partyId);
    expect(await todayRow(tableId)).toMatchObject({ x: 30 });
    await readFloor();

    expect(await todayRow(tableId)).toMatchObject({ x: 30 });
    expect(await readyOf(tableId)).toEqual({ pending: true, readyToMove: true });
  });

  it("removes a table deleted from the master once its party finishes", async () => {
    const label = fresh("T4");
    const { zoneId, tableId, revision } = await plannedTable(label);
    const other = fresh("T5");
    const partyId = await seatAt(tableId);
    await save(zoneId, revision, [entry("other", other, { placement: place(20, 0) })]);
    await reset(zoneId);
    expect((await readFloor()).map((t) => t.id)).toContain(tableId);

    await finish(partyId);
    expect(await tableExists(tableId)).toBe(true);
    const floor = await readFloor();

    expect(await tableExists(tableId)).toBe(false);
    expect(floor.map((t) => t.id)).not.toContain(tableId);
    expect(floor.map((t) => t.label)).toContain(other);
  });

  it("creates a new table that was waiting for its name once the old one is free", async () => {
    const four = fresh("Terrace 4");
    const nine = fresh("Terrace 9");
    const { zoneId, tableId, masterId, revision } = await plannedTable(four);
    const partyId = await seatAt(tableId);
    await save(zoneId, revision, [
      entry("t", nine, { id: masterId }),
      entry("new", four, { placement: place(20, 0) }),
    ]);
    await reset(zoneId);
    expect((await tableRow(v, tableId)).label).toBe(four);

    await finish(partyId);
    const floor = await readFloor();

    expect(floor.find((t) => t.id === tableId)?.label).toBe(nine);
    const created = floor.find((t) => t.label === four);
    expect(created).toBeDefined();
    expect(created!.id).not.toBe(tableId);
  });

  it("frees a table when its delivery is collected, at the next read", async () => {
    const label = fresh("Delivered");
    const { zoneId, tableId, revision } = await plannedTable(label);
    const order = await counterOrder(v, "Paella");
    await inTx(v, (tx) =>
      tx.update(workingOrders).set({ deliveryTableId: tableId }).where(eq(workingOrders.id, order)),
    );
    await save(zoneId, revision, []);
    await reset(zoneId);
    expect(await tableExists(tableId)).toBe(true);

    await pay(v, order, "20.00");
    await inTx(v, (tx) => handOverOrder(tx, v.cfg, order));
    expect(await tableExists(tableId)).toBe(true);
    await readFloor();

    expect(await tableExists(tableId)).toBe(false);
    const [released] = await inTx(v, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, order)),
    );
    expect(released).toMatchObject({ deliveryTableId: null, deliveryTableLabel: label });
  });

  it("a table made a part while a party sits at it keeps its joined table waiting, then needing moving once the party finishes", async () => {
    const zoneId = await zone();
    const [long, c3, c4, c5] = [
      fresh("Long"),
      fresh("Counter 3"),
      fresh("Counter 4"),
      fresh("Counter 5"),
    ];
    const first = await save(zoneId, 0, [
      entry("c3", c3, { seats: 2, placement: place(0, 0) }),
      entry("c4", c4, { seats: 6, placement: place(20, 0) }),
      entry("c5", c5, { seats: 4, placement: place(40, 0) }),
    ]);
    const plan = await inTx(v, async (tx) =>
      readLayout(tx, await defaultLayout(tx, v.cfg, zoneId)),
    );
    const liveOf = (key: string) => plan.tables.find((t) => t.id === first.ids[key])!.liveTableId!;
    const [t3, t4, t5] = [liveOf("c3"), liveOf("c4"), liveOf("c5")];
    const partyId = await seatAt(t3);
    await save(zoneId, first.revision, [
      entry("c3", c3, { id: first.ids.c3, seats: 2, placement: null }),
      entry("c4", c4, { id: first.ids.c4, seats: 6, placement: null }),
      entry("c5", c5, { id: first.ids.c5, seats: 4, placement: null }),
      entry("long", long, { seats: 10, placement: place(0, 20), partKeys: ["c3", "c4", "c5"] }),
    ]);
    const answer = await send("POST", `/api/zones/${zoneId}/today/reset`, {});
    expect({ status: answer.status, body: await answer.json() }).toEqual({
      status: 200,
      body: { zoneId, revision: (await zoneRevisionOf(v, zoneId))! },
    });

    const before = await readJoined();
    expect(before.get(t3)).toBeNull();
    expect(before.get(t4)).toBeNull();
    expect(before.get(t5)).toBeNull();

    await finish(partyId);
    const after = await readJoined();
    expect(after.get(t3)).toBeNull();
    expect(after.get(t4)).toBeNull();
    expect(after.get(t5)).toBeNull();
    for (const part of [t3, t4, t5]) {
      expect(await readyOf(part)).toEqual({ pending: true, readyToMove: true });
    }
  });

  it("does nothing when no reset happened while the table was taken", async () => {
    const { zoneId, tableId } = await plannedTable(fresh("Kept"));
    const zoneRevision = await zoneRevisionOf(v, zoneId);
    const partyId = await seatAt(tableId);
    await moveToday(tableId, 30);

    await finish(partyId);
    await readFloor();

    expect(await todayRow(tableId)).toMatchObject({ x: 30 });
    expect(await zoneRevisionOf(v, zoneId)).toBe(zoneRevision);
  });
});

/**
 * Runs `act` at 05:00 Madrid on the next business day (cutover 04:00), then puts the venue's
 * cutover and every zone's day back, so later cases start on NOW's business day again.
 */
async function onNextDay(act: () => Promise<void>): Promise<void> {
  const [{ cutover }] = (await inTx(v, (tx) =>
    Promise.resolve(
      tx.all<{ cutover: string }>(
        sql`select c.day_cutover as cutover from locations l join settings b on b.module = 'business_day' join day_cutover_changes c on c.effective_business_day = '2000-01-01'`,
      ),
    ),
  )) as [{ cutover: string }];
  await inTx(v, (tx) => seedBusinessDay(tx, { dayCutover: "04:00" }));
  // Two hours ahead of UTC on this date.
  clockAt = new Date("2026-10-11T03:00:00Z");
  try {
    await act();
  } finally {
    clockAt = NOW;
    await withTransaction(v.db, async (tx) => {
      await seedBusinessDay(tx, { dayCutover: cutover });
      await tx
        .update(floorZones)
        .set({ todayBusinessDay: "2026-10-10" })
        .where(eq(floorZones.todayBusinessDay, "2026-10-11"));
    });
  }
}

/** A zone whose master renames its one live table; answers the ids and both names. */
async function renamedInMaster() {
  const label = fresh("Day");
  const renamed = fresh("Day b");
  const planned = await plannedTable(label);
  await save(planned.zoneId, planned.revision, [entry("t", renamed, { id: planned.masterId })]);
  return { ...planned, label, renamed, zoneRevision: (await zoneRevisionOf(v, planned.zoneId))! };
}

/** Seats `tableId`'s party at a second free table of the venue's tables zone too. */
async function joinSecond(partyId: string): Promise<string> {
  const second = await v.table(fresh("Second"));
  const answer = await send("POST", `/api/parties/${partyId}/join`, {
    tableId: second,
    expectedPartyRevision: await revisionOf(v, partyId),
  });
  expect(answer.status).toBe(200);
  return second;
}

describe("on a new business day, the till's floor routes reset today's plan before acting", () => {
  it("resets before seating", async () => {
    const { zoneId, tableId, renamed, zoneRevision } = await renamedInMaster();

    await onNextDay(async () => {
      await seatAt(tableId);

      expect(await zoneRevisionOf(v, zoneId)).toBe(zoneRevision + 1);
      expect((await tableRow(v, tableId)).label).toBe(renamed);
    });
  });

  // The party sits outside the planned zone; the planned zone shows whether the reset ran. Each
  // body is built on the old day, so split's join runs before the reset is due.
  const routes: [string, string, (partyId: string) => Promise<Record<string, unknown>>][] = [
    ["finish", "finish", async () => ({})],
    ["move", "move", async () => ({ toTableId: await v.table(fresh("Move to")) })],
    ["join", "join", async () => ({ tableId: await v.table(fresh("Join to")) })],
    [
      "split",
      "split-table",
      async (partyId) => ({ tableId: await joinSecond(partyId), selection: oneBill(null) }),
    ],
  ];

  it.each(routes)("resets before %s", async (_, path, bodyFor) => {
    const { zoneId, tableId, renamed, zoneRevision } = await renamedInMaster();
    const partyId = await seatAt(await v.table(fresh("Seated")));
    const body = await bodyFor(partyId);

    await onNextDay(async () => {
      const answer = await send("POST", `/api/parties/${partyId}/${path}`, {
        ...body,
        expectedPartyRevision: await revisionOf(v, partyId),
      });

      expect(answer.status).toBe(200);
      expect(await zoneRevisionOf(v, zoneId)).toBe(zoneRevision + 1);
      expect((await tableRow(v, tableId)).label).toBe(renamed);
    });
  });
});

/** The live table each of the first save's entries made, by entry key. */
async function liveIdsOf(zoneId: string, ids: Record<string, string>) {
  const plan = await inTx(v, async (tx) => readLayout(tx, await defaultLayout(tx, v.cfg, zoneId)));
  return (key: string) => plan.tables.find((t) => t.id === ids[key])!.liveTableId!;
}

async function refusal(answer: Promise<Response>): Promise<{ status: number; body: unknown }> {
  const settled = await answer;
  return { status: settled.status, body: await settled.json() };
}

/** Today's rows of the tables, in the order given. */
async function todayRows(tableIds: readonly string[]) {
  const rows = [];
  for (const id of tableIds) rows.push(await todayRow(id));
  return rows;
}

const MARKED = "2026-10-10T11:00:00.000Z";

const markNeedsClearing = (tableId: string) =>
  inTx(v, (tx) =>
    tx.update(diningTables).set({ needsClearingSince: MARKED }).where(eq(diningTables.id, tableId)),
  );

async function resetRowOf(tableId: string) {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ pending: floorResetTables.pending, placed: floorResetTables.placed })
      .from(floorResetTables)
      .where(eq(floorResetTables.tableId, tableId)),
  );
  return row;
}

function standardAndDinner(
  tables: { key: string; label: string; partKeys?: string[] }[],
  placedIn: { standard: Record<string, number | null>; dinner: Record<string, number | null> },
) {
  return standardAndDinnerIn(v, NOW, tables, placedIn);
}

/** 4 and 5 stand in Standard and 4+5 is off; Dinner stands 4+5 and leaves 4 and 5 off. */
async function fourAndFive() {
  const s = await standardAndDinner(
    [
      { key: "t4", label: fresh("4") },
      { key: "t5", label: fresh("5") },
      { key: "t45", label: fresh("4+5"), partKeys: ["t4", "t5"] },
    ],
    { standard: { t4: 0, t5: 20, t45: null }, dinner: { t4: null, t5: null, t45: 0 } },
  );
  return { ...s, t4: s.live("t4"), t5: s.live("t5"), t45: s.live("t45") };
}

describe("the reset waiting rules", () => {
  it("a free table needing clearing stays where it is at Reset to {set} plan", async () => {
    const { zoneId, tableId } = await plannedTable(fresh("Wiped"));
    await reset(zoneId);
    await moveToday(tableId, 30);
    await markNeedsClearing(tableId);

    await reset(zoneId);

    expect(await todayRow(tableId)).toMatchObject({ x: 30 });
    expect(await resetRowOf(tableId)).toEqual({ pending: true, placed: false });
    expect((await tableRow(v, tableId)).needsClearingSince).toBe(MARKED);
  });

  it("a table needing clearing with no today's row gets one at Reset to {set} plan, as a held one does", async () => {
    const { zoneId, tableId } = await plannedTable(fresh("Unrowed"));
    await reset(zoneId);
    await inTx(v, (tx) =>
      tx.update(diningTables).set(OFF_FLOOR).where(eq(diningTables.id, tableId)),
    );
    await markNeedsClearing(tableId);

    await reset(zoneId);

    expect(await todayRow(tableId)).toMatchObject({ x: 0, takenOff: false });
    expect(await resetRowOf(tableId)).toEqual({ pending: true, placed: false });
  });

  it("the zone reset no longer clears needs clearing on split-off tables it takes back", async () => {
    const zoneId = await zone();
    const [long, c3, c4] = [fresh("Long"), fresh("Counter 3"), fresh("Counter 4")];
    const { ids } = await save(zoneId, 0, [
      entry("c3", c3, { placement: null }),
      entry("c4", c4, { placement: null }),
      entry("long", long, { placement: place(0, 20), partKeys: ["c3", "c4"] }),
    ]);
    await reset(zoneId);
    const liveOf = await liveIdsOf(zoneId, ids);
    const [t3, t4] = [liveOf("c3"), liveOf("c4")];
    await expectRevision(
      v,
      send("POST", `/api/tables/${t3}/today/split-off`, { partIds: [t4], seats: 2 }),
    );
    await markNeedsClearing(t4);
    expect(await mergeOf(v, t3)).toBeNull();
    expect(await mergeOf(v, t4)).toBeNull();
    const before = await todayRows([t3, t4]);

    await reset(zoneId);

    expect((await tableRow(v, t4)).needsClearingSince).toBe(MARKED);
    expect(await mergeOf(v, t3)).toBeNull();
    expect(await todayRows([t3, t4])).toEqual(before);
    expect(await resetRowOf(t3)).toEqual({ pending: true, placed: false });
  });

  it("a joined table the reset creates waits while guests sit at one of its parts", async () => {
    const zoneId = await zone();
    const [long, c3, c4, c5] = [
      fresh("Long"),
      fresh("Counter 3"),
      fresh("Counter 4"),
      fresh("Counter 5"),
    ];
    const first = await save(zoneId, 0, [
      entry("c3", c3, { placement: place(0, 0) }),
      entry("c4", c4, { placement: place(20, 0) }),
      entry("c5", c5, { placement: place(40, 0) }),
    ]);
    await reset(zoneId);
    const liveOf = await liveIdsOf(zoneId, first.ids);
    const parts = [liveOf("c3"), liveOf("c4"), liveOf("c5")];
    const partyId = await seatAt(parts[0]!);
    await save(zoneId, first.revision, [
      entry("c3", c3, { id: first.ids.c3, placement: null }),
      entry("c4", c4, { id: first.ids.c4, placement: null }),
      entry("c5", c5, { id: first.ids.c5, placement: null }),
      entry("long", long, { placement: place(0, 20), partKeys: ["c3", "c4", "c5"] }),
    ]);
    const before = await todayRows(parts);

    await reset(zoneId);

    expect((await readFloor()).map((t) => t.label)).not.toContain(long);
    expect(await todayRows(parts)).toEqual(before);
    for (const part of parts) {
      expect(await resetRowOf(part)).toEqual({ pending: true, placed: false });
    }
    const joined = await readJoined();
    for (const part of parts) expect(joined.get(part)).toBeNull();

    await finish(partyId);

    const after = await readJoined();
    for (const part of parts) {
      expect(after.get(part)).toBeNull();
      expect(await readyOf(part)).toEqual({ pending: true, readyToMove: true });
    }
    expect(await todayRows(parts)).toEqual(before);
  });

  it("taking 4 into 4+5 waits while 4 has guests", async () => {
    const z = await fourAndFive();
    await z.onto(z.d.standard);
    await seatAt(z.t4);
    const before = await todayRows([z.t4, z.t5, z.t45]);
    expect(before.map((row) => row?.x)).toEqual([0, 20, undefined]);

    await z.onto(z.d.dinner);

    expect(await todayRows([z.t4, z.t5, z.t45])).toEqual(before);
    const joined = await readJoined();
    expect(joined.get(z.t4)).toBeNull();
    expect(joined.get(z.t5)).toBeNull();
    await seatAt(z.t5);
  });

  it("4+5 with guests waits joined under a layout that leaves it off", async () => {
    const z = await fourAndFive();
    await z.onto(z.d.dinner);
    await seatAt(z.t4);
    const longBefore = await todayRow(z.t4);
    expect(longBefore).toMatchObject({ x: 0 });

    await z.onto(z.d.standard);

    expect(await todayRow(z.t4)).toEqual(longBefore);
    for (const part of [z.t4, z.t5]) {
      expect(await resetRowOf(part)).toEqual({ pending: true, placed: false });
      expect((await todayRow(part))?.x).not.toBeNull();
      expect(await refusal(send("POST", `/api/tables/${part}/seat`, {}))).toEqual({
        status: 409,
        body: { error: { code: "tab.already_open", params: { tableId: part } } },
      });
    }
  });

  /** Table 9 stands at 0 in Standard and at 40 in Dinner, and is taken off today under Standard. */
  async function nineTakenOff() {
    const s = await standardAndDinner([{ key: "t9", label: fresh("9") }], {
      standard: { t9: 0 },
      dinner: { t9: 40 },
    });
    await s.onto(s.d.standard);
    const t9 = s.live("t9");
    await inTx(v, (tx) =>
      tx
        .update(diningTables)
        .set(todaySet({ takenOff: true }))
        .where(eq(diningTables.id, t9)),
    );
    return { ...s, t9 };
  }

  it("Update layout keeps table 9 off at its new place", async () => {
    const z = await nineTakenOff();

    await z.update(z.d.dinner);

    expect(await todayRow(z.t9)).toMatchObject({ x: 40, takenOff: true });
  });

  it("a reset onto a set puts table 9 back at its new place", async () => {
    const z = await nineTakenOff();

    await z.onto(z.d.dinner);

    expect(await todayRow(z.t9)).toMatchObject({ x: 40, takenOff: false });
  });
});

async function readyOf(tableId: string) {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ pending: floorResetTables.pending, readyToMove: floorResetTables.readyToMove })
      .from(floorResetTables)
      .where(eq(floorResetTables.tableId, tableId)),
  );
  return row;
}

/** The till's floor read, by table. */
async function readStates() {
  const answer = await send("GET", "/api/tables/state");
  expect(answer.status).toBe(200);
  const tables = (await answer.json()) as {
    id: string;
    label: string;
    condition: string;
    today: { needsMoving: boolean };
  }[];
  return new Map(tables.map((t) => [t.id, t]));
}

const needsClearingEverywhere = (on: boolean) =>
  inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, on));

/**
 * Table 3 stands at 0 in Standard and 40 in Dinner, beside `more`; guests sit at 3 when the zone
 * resets onto Dinner.
 */
async function threeSeatedAcrossDinner(
  more: { key: string; standard: number | null; dinner: number | null; partKeys?: string[] }[] = [],
) {
  const s = await standardAndDinner(
    [
      { key: "t3", label: fresh("3") },
      ...more.map((m) => ({ key: m.key, label: fresh(m.key), partKeys: m.partKeys })),
    ],
    {
      standard: { t3: 0, ...Object.fromEntries(more.map((m) => [m.key, m.standard])) },
      dinner: { t3: 40, ...Object.fromEntries(more.map((m) => [m.key, m.dinner])) },
    },
  );
  await s.onto(s.d.standard);
  const t3 = s.live("t3");
  const partyId = await seatAt(t3);
  await s.onto(s.d.dinner);
  expect(await todayRow(t3)).toMatchObject({ x: 0 });
  return { ...s, t3, partyId };
}

describe("a table that frees up after a reset needs moving", () => {
  it("a table that frees up after a reset needs moving and stays put", async () => {
    await needsClearingEverywhere(false);
    const z = await threeSeatedAcrossDinner();

    await finish(z.partyId);
    const states = await readStates();

    expect(await todayRow(z.t3)).toMatchObject({ x: 0 });
    expect(await readyOf(z.t3)).toEqual({ pending: true, readyToMove: true });
    expect(states.get(z.t3)!.today.needsMoving).toBe(true);
    await readStates();
    expect(await todayRow(z.t3)).toMatchObject({ x: 0 });
  });

  it("with clearing on, a table shows Needs clearing first and Needs moving once cleared", async () => {
    try {
      const z = await threeSeatedAcrossDinner();
      await needsClearingEverywhere(true);

      await finish(z.partyId);
      const first = await readStates();
      expect(await readyOf(z.t3)).toEqual({ pending: true, readyToMove: false });
      expect(first.get(z.t3)).toMatchObject({
        condition: "needs_clearing",
        today: { needsMoving: false },
      });

      const cleared = await send("POST", `/api/tables/${z.t3}/cleared`, {});
      expect(cleared.status).toBe(204);
      const second = await readStates();

      expect(await readyOf(z.t3)).toEqual({ pending: true, readyToMove: true });
      expect(second.get(z.t3)!.today.needsMoving).toBe(true);
      expect(await todayRow(z.t3)).toMatchObject({ x: 0 });
    } finally {
      await needsClearingEverywhere(false);
    }
  });

  it("a seats-only change still applies by itself", async () => {
    await needsClearingEverywhere(false);
    const label = fresh("Seats");
    const { zoneId, tableId, masterId, revision } = await plannedTable(label);
    const partyId = await seatAt(tableId);
    await save(zoneId, revision, [entry("t", label, { id: masterId, seats: 6 })]);
    await reset(zoneId);
    expect(await todayRow(tableId)).toMatchObject({ seats: 4 });

    await finish(partyId);
    const states = await readStates();

    expect(await todayRow(tableId)).toMatchObject({ x: 0, seats: 6 });
    expect(await readyOf(tableId)).toEqual({ pending: false, readyToMove: false });
    expect(states.get(tableId)!.today.needsMoving).toBe(false);
  });

  it("a row waiting for its name still applies", async () => {
    await needsClearingEverywhere(false);
    const zoneId = await zone();
    const [p, q, r] = [fresh("P"), fresh("Q"), fresh("R")];
    const first = await save(zoneId, 0, [
      entry("p", p, { placement: place(0, 0) }),
      entry("q", q, { placement: place(20, 0) }),
    ]);
    const liveOf = await liveIdsOf(zoneId, first.ids);
    const [tp, tq] = [liveOf("p"), liveOf("q")];
    const partyId = await seatAt(tq);
    await save(zoneId, first.revision, [
      entry("p", q, { id: first.ids.p, placement: place(50, 0) }),
      entry("q", r, { id: first.ids.q, placement: place(20, 0) }),
    ]);
    await reset(zoneId);
    expect(await readyOf(tp)).toEqual({ pending: true, readyToMove: false });
    await moveToday(tp, 30);

    await finish(partyId);
    await readStates();

    expect((await tableRow(v, tp)).label).toBe(q);
    expect((await tableRow(v, tq)).label).toBe(r);
    expect(await todayRow(tp)).toMatchObject({ x: 30 });
    expect(await readyOf(tp)).toEqual({ pending: false, readyToMove: false });
  });

  it("a table seated with no today's row is still seeded", async () => {
    await needsClearingEverywhere(false);
    const label = fresh("Unrowed seat");
    const { zoneId, tableId, masterId, revision } = await plannedTable(label);
    const partyId = await seatAt(tableId);
    await inTx(v, (tx) =>
      tx.update(diningTables).set(OFF_FLOOR).where(eq(diningTables.id, tableId)),
    );
    await save(zoneId, revision, [entry("t", label, { id: masterId, placement: place(50, 0) })]);

    await reset(zoneId);
    expect(await todayRow(tableId)).toMatchObject({ x: 50, takenOff: false });

    await finish(partyId);
    await readStates();
    expect(await todayRow(tableId)).toMatchObject({ x: 50 });
    expect(await readyOf(tableId)).toEqual({ pending: false, readyToMove: false });
  });

  it("the floor read after Split marks another table, not moves it", async () => {
    await needsClearingEverywhere(false);
    const z = await plannedZone(
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
        { key: "t3", label: "3", place: { x: 60, y: 0 } },
      ],
      NOW,
    );
    for (const key of ["c3", "c4", "c5"])
      await giveKeptSize(v, z.master[key]!, { width: 2, height: 2 });
    const [t3, long, bar] = [z.table.t3!, z.table.c3!, z.table.bar!];
    const partyId = await seatAt(t3);
    const layout = await inTx(v, (tx) => defaultLayout(tx, v.cfg, z.zoneId));
    const saved = await inTx(v, (tx) => readLayout(tx, layout));
    await save(
      z.zoneId,
      saved.revision,
      saved.tables.map((t) => ({
        id: t.id,
        key: t.id,
        label: t.label,
        seats: t.seats,
        fixed: t.fixed,
        placement: t.id === z.master.t3 ? place(80, 0) : t.placement,
        partKeys: t.partIds,
      })),
    );
    await reset(z.zoneId);
    await inTx(v, (tx) =>
      writeMerge(tx, v.cfg, { movingId: bar, targetId: long, side: "left", seats: 12, free: true }),
    );
    await finish(partyId);
    expect(await readyOf(t3)).toEqual({ pending: true, readyToMove: false });

    await inTx(v, (tx) =>
      splitOff(tx, v.cfg, REMOVALS, NOW, {
        tableId: bar,
        partIds: [bar],
        seats: 10,
        expectedParties: [],
      }),
    );

    await readStates();
    expect(await mergeOf(v, bar)).toBeNull();
    expect(await readyOf(t3)).toEqual({ pending: true, readyToMove: true });
    expect(await todayRow(t3)).toMatchObject({ x: 60 });
  });

  it("a marked table taken off the map goes to its new place by itself, still off", async () => {
    await needsClearingEverywhere(false);
    const z = await threeSeatedAcrossDinner();
    await finish(z.partyId);
    expect((await readStates()).get(z.t3)!.today.needsMoving).toBe(true);

    await expectRevision(v, send("POST", `/api/tables/${z.t3}/today/take-off`, {}));
    const states = await readStates();

    expect(await readyOf(z.t3)).toEqual({ pending: false, readyToMove: false });
    expect(await todayRow(z.t3)).toMatchObject({ x: 40, takenOff: true });
    expect(states.get(z.t3)!.today.needsMoving).toBe(false);
  });

  it("a room whose only waiting rows still need moving is not caught up again", async () => {
    await needsClearingEverywhere(false);
    const z = await threeSeatedAcrossDinner();
    const due = async () =>
      (
        await inTx(v, (tx) =>
          tx
            .select({ id: floorZones.id })
            .from(floorZones)
            .where(and(eq(floorZones.id, z.d.zoneId), catchUpDue(floorZones.id))),
        )
      ).length;
    expect(await due()).toBe(1);

    await finish(z.partyId);
    await readStates();
    expect(await readyOf(z.t3)).toEqual({ pending: true, readyToMove: true });
    expect(await due()).toBe(0);

    await inTx(v, (tx) =>
      tx
        .update(diningTables)
        .set(todaySet({ takenOff: true }))
        .where(eq(diningTables.id, z.t3)),
    );
    expect(await due()).toBe(1);
  });

  /** Whether the till's floor read would catch the room up. */
  async function dueIn(zoneId: string): Promise<number> {
    const rows = await inTx(v, (tx) =>
      tx
        .select({ id: floorZones.id })
        .from(floorZones)
        .where(and(eq(floorZones.id, zoneId), catchUpDue(floorZones.id))),
    );
    return rows.length;
  }

  const setToday = (tableId: string, values: Partial<import("@waitron/db").TodayRow>) =>
    inTx(v, (tx) =>
      tx.update(diningTables).set(todaySet(values)).where(eq(diningTables.id, tableId)),
    );

  it("a marked table moved by hand onto its new place applies by itself, but not while turned", async () => {
    await needsClearingEverywhere(false);
    const z = await threeSeatedAcrossDinner();
    await finish(z.partyId);
    await readStates();

    await setToday(z.t3, { x: 40, rotation: 15 });
    expect(await dueIn(z.d.zoneId)).toBe(0);
    expect((await readStates()).get(z.t3)!.today.needsMoving).toBe(true);
    expect(await readyOf(z.t3)).toEqual({ pending: true, readyToMove: true });

    await setToday(z.t3, { rotation: 0 });
    expect(await dueIn(z.d.zoneId)).toBe(1);
    await readStates();
    expect(await readyOf(z.t3)).toEqual({ pending: false, readyToMove: false });
  });

  it("a marked table that loses its place applies by itself at its new place", async () => {
    await needsClearingEverywhere(false);
    const z = await threeSeatedAcrossDinner();
    await finish(z.partyId);
    await readStates();

    await setToday(z.t3, {
      x: null,
      y: null,
      width: null,
      height: null,
      shape: null,
      rotation: null,
    });
    expect(await dueIn(z.d.zoneId)).toBe(1);
    await readStates();

    expect(await readyOf(z.t3)).toEqual({ pending: false, readyToMove: false });
    expect(await todayRow(z.t3)).toMatchObject({ x: 40, takenOff: false });
  });
});

describe("no reset puts a table down on another", () => {
  const setToday = (tableId: string, values: Partial<import("@waitron/db").TodayRow>) =>
    inTx(v, (tx) =>
      tx.update(diningTables).set(todaySet(values)).where(eq(diningTables.id, tableId)),
    );
  const at = (x: number) => ({ x, y: 0, width: 8, height: 8, shape: "rect" as const, rotation: 0 });

  async function dueIn(zoneId: string): Promise<number> {
    const rows = await inTx(v, (tx) =>
      tx
        .select({ id: floorZones.id })
        .from(floorZones)
        .where(and(eq(floorZones.id, zoneId), catchUpDue(floorZones.id))),
    );
    return rows.length;
  }

  /** Stored 6 goes to 40 in Dinner, where 7 stands in Standard; guests sit at 7 across the reset onto Dinner. */
  async function sixBehindSeven(
    more: {
      key: string;
      standard: number | null;
      dinner: number | null;
      partKeys?: string[];
    }[] = [],
  ) {
    const s = await standardAndDinner(
      [
        { key: "t6", label: fresh("6") },
        { key: "t7", label: fresh("7") },
        ...more.map((m) => ({ key: m.key, label: fresh(m.key), partKeys: m.partKeys })),
      ],
      {
        standard: { t6: null, t7: 40, ...Object.fromEntries(more.map((m) => [m.key, m.standard])) },
        dinner: { t6: 40, t7: 80, ...Object.fromEntries(more.map((m) => [m.key, m.dinner])) },
      },
    );
    await s.onto(s.d.standard);
    const [t6, t7] = [s.live("t6"), s.live("t7")];
    const partyId = await seatAt(t7);
    await s.onto(s.d.dinner);
    expect(await todayRow(t6)).toMatchObject({ x: null });
    expect(await readyOf(t6)).toEqual({ pending: true, readyToMove: false });
    return { ...s, t6, t7, partyId };
  }

  it("Update to Dinner keeps 2 and 1 in place while 3 waits", async () => {
    await needsClearingEverywhere(false);
    const s = await standardAndDinner(
      [
        { key: "t3", label: fresh("3") },
        { key: "t2", label: fresh("2") },
        { key: "t1", label: fresh("1") },
      ],
      { standard: { t3: 0, t2: 20, t1: 40 }, dinner: { t3: 80, t2: 0, t1: 20 } },
    );
    await s.onto(s.d.standard);
    const [t3, t2, t1] = [s.live("t3"), s.live("t2"), s.live("t1")];
    await seatAt(t3);

    await s.update(s.d.dinner);

    expect(await todayRows([t3, t2, t1])).toMatchObject([{ x: 0 }, { x: 20 }, { x: 40 }]);
    expect(await readyOf(t3)).toEqual({ pending: true, readyToMove: false });
    expect(await readyOf(t2)).toEqual({ pending: true, readyToMove: true });
    expect(await readyOf(t1)).toEqual({ pending: true, readyToMove: true });
    const states = await readStates();
    expect([t3, t2, t1].map((id) => states.get(id)!.today.needsMoving)).toEqual([
      false,
      true,
      true,
    ]);
    expect(await todayRows([t3, t2, t1])).toMatchObject([{ x: 0 }, { x: 20 }, { x: 40 }]);
  });

  it("a stored table whose new place is taken waits off the map, and a later read places it once the place is clear", async () => {
    await needsClearingEverywhere(false);
    const z = await sixBehindSeven();

    const states = await readStates();
    expect(states.get(z.t6)!.today.needsMoving).toBe(false);
    expect(await todayRow(z.t6)).toMatchObject({ x: null });
    expect(await readyOf(z.t6)).toEqual({ pending: true, readyToMove: false });

    await setToday(z.t7, { x: 100 });
    await readStates();

    expect(await todayRow(z.t6)).toMatchObject({ x: 40, takenOff: false });
    expect(await readyOf(z.t6)).toEqual({ pending: false, readyToMove: false });
  });

  it("a taken-off table blocks nothing", async () => {
    const s = await standardAndDinner(
      [
        { key: "t6", label: fresh("6") },
        { key: "t7", label: fresh("7") },
      ],
      { standard: { t6: null, t7: 40 }, dinner: { t6: 40, t7: 40 } },
    );
    await s.onto(s.d.standard);
    const [t6, t7] = [s.live("t6"), s.live("t7")];
    await setToday(t7, { takenOff: true });

    await s.update(s.d.dinner);

    expect(await todayRow(t6)).toMatchObject({ x: 40, takenOff: false });
    expect(await readyOf(t6)).toEqual({ pending: false, readyToMove: false });
    expect(await todayRow(t7)).toMatchObject({ x: 40, takenOff: true });
  });

  it("Update layout keeps a taken-off table off at its new place even while another table stands there", async () => {
    const s = await standardAndDinner(
      [
        { key: "t9", label: fresh("9") },
        { key: "t7", label: fresh("7") },
      ],
      { standard: { t9: 0, t7: 40 }, dinner: { t9: 40, t7: 80 } },
    );
    await s.onto(s.d.standard);
    const [t9, t7] = [s.live("t9"), s.live("t7")];
    await setToday(t9, { takenOff: true });
    await seatAt(t7);

    await s.update(s.d.dinner);

    expect(await todayRow(t9)).toMatchObject({ x: 40, takenOff: true });
    expect(await readyOf(t9)).toEqual({ pending: false, readyToMove: false });
  });

  it("a table blocked on a later read is marked, and a stored table may then be put down on it, as it needs moving (spec §7.5, No lock)", async () => {
    await needsClearingEverywhere(false);
    const s = await standardAndDinner(
      [
        { key: "b", label: fresh("B") },
        { key: "c", label: fresh("C") },
        { key: "t6", label: fresh("6") },
      ],
      { standard: { b: 0, c: 40, t6: null }, dinner: { b: 40, c: 80, t6: 0 } },
    );
    await s.onto(s.d.standard);
    const [b, c, t6] = [s.live("b"), s.live("c"), s.live("t6")];
    const partyB = await seatAt(b);
    await seatAt(c);
    await s.onto(s.d.dinner);
    expect(await todayRow(t6)).toMatchObject({ x: null });

    await finish(partyB);
    const states = await readStates();

    expect(await readyOf(b)).toEqual({ pending: true, readyToMove: true });
    expect(states.get(b)!.today.needsMoving).toBe(true);
    expect(await todayRow(b)).toMatchObject({ x: 0 });
    expect(await todayRow(t6)).toMatchObject({ x: 0 });
  });

  it("a free table whose new place is taken on a later read is marked, and the room is not caught up again", async () => {
    await needsClearingEverywhere(false);
    const s = await standardAndDinner(
      [
        { key: "b", label: fresh("B") },
        { key: "c", label: fresh("C") },
      ],
      { standard: { b: 0, c: 80 }, dinner: { b: 40, c: 80 } },
    );
    await s.onto(s.d.standard);
    const [b, c] = [s.live("b"), s.live("c")];
    const partyB = await seatAt(b);
    await s.onto(s.d.dinner);
    await setToday(c, { x: 40 });

    await finish(partyB);
    await readStates();

    expect(await readyOf(b)).toEqual({ pending: true, readyToMove: true });
    expect(await todayRow(b)).toMatchObject({ x: 0 });
    expect(await dueIn(s.d.zoneId)).toBe(0);
  });

  it("a joined group waiting for its stored joined table's place is not caught up on every read", async () => {
    await needsClearingEverywhere(false);
    const s = await standardAndDinner(
      [
        { key: "t4", label: fresh("4") },
        { key: "t5", label: fresh("5") },
        { key: "t45", label: fresh("4+5"), partKeys: ["t4", "t5"] },
        { key: "t8", label: fresh("8") },
      ],
      {
        standard: { t4: 0, t5: 20, t45: null, t8: 120 },
        dinner: { t4: null, t5: null, t45: 60, t8: 120 },
      },
    );
    await s.onto(s.d.standard);
    const [t4, t5, t45] = [s.live("t4"), s.live("t5"), s.live("t45")];
    const partyId = await seatAt(t4);
    await s.onto(s.d.dinner);
    await setToday(s.live("t8"), { x: 60 });

    await finish(partyId);
    await readStates();

    expect(await todayRows([t4, t5])).toMatchObject([{ x: 0 }, { x: 20 }]);
    expect(await todayRow(t45)).toBeUndefined();
    expect(await readyOf(t4)).toEqual({ pending: true, readyToMove: false });
    expect(await dueIn(s.d.zoneId)).toBe(0);
  });

  /** 6 waits behind 8, moved onto its new place by hand; 7 needs moving; nothing else waits. */
  async function sixBehindEight(
    more: {
      key: string;
      standard: number | null;
      dinner: number | null;
      partKeys?: string[];
    }[] = [],
  ) {
    const z = await sixBehindSeven([{ key: "t8", standard: 120, dinner: 120 }, ...more]);
    const t8 = z.live("t8");
    await setToday(t8, { x: 40 });
    await finish(z.partyId);
    await readStates();
    expect(await readyOf(z.t7)).toEqual({ pending: true, readyToMove: true });
    expect(await readyOf(z.t6)).toEqual({ pending: true, readyToMove: false });
    expect(await dueIn(z.d.zoneId)).toBe(0);
    return { ...z, t8 };
  }

  it("a room whose only waiting rows are stored tables with their place taken is caught up only once the place clears", async () => {
    await needsClearingEverywhere(false);
    const z = await sixBehindEight();
    expect(await todayRow(z.t6)).toMatchObject({ x: null });

    await setToday(z.t8, { x: 120 });
    expect(await dueIn(z.d.zoneId)).toBe(1);
    await readStates();

    expect(await todayRow(z.t6)).toMatchObject({ x: 40 });
    expect(await readyOf(z.t6)).toEqual({ pending: false, readyToMove: false });
  });

  it("a table taken off after the reset no longer blocks a stored table", async () => {
    await needsClearingEverywhere(false);
    const z = await sixBehindEight();

    await setToday(z.t8, { takenOff: true });
    expect(await dueIn(z.d.zoneId)).toBe(1);
    await readStates();

    expect(await todayRow(z.t6)).toMatchObject({ x: 40, takenOff: false });
  });

  /** Dinner, as its editor saved it, stands stored 6 at 40 and 8 at 44, over half of 6. */
  async function sixUnderEight() {
    const s = await standardAndDinner(
      [
        { key: "t6", label: fresh("6") },
        { key: "t8", label: fresh("8") },
      ],
      { standard: { t6: null, t8: 44 }, dinner: { t6: 40, t8: 44 } },
    );
    await s.onto(s.d.standard);
    return { ...s, t6: s.live("t6"), t8: s.live("t8") };
  }

  it("a stored table is put down where its layout overlaps a table standing in that layout's place for it", async () => {
    const z = await sixUnderEight();

    await z.onto(z.d.dinner);

    expect(await todayRow(z.t6)).toMatchObject({ x: 40, takenOff: false });
    expect(await readyOf(z.t6)).toEqual({ pending: false, readyToMove: false });
    expect(await todayRow(z.t8)).toMatchObject({ x: 44 });
  });

  it("a stored table waiting behind a table off its own place is caught up once that table stands in it", async () => {
    await needsClearingEverywhere(false);
    // Dinner stands stored 6 at 40 and 8 at 46, over two squares of 6; seated 7 stands at 36.
    const s = await standardAndDinner(
      [
        { key: "t6", label: fresh("6") },
        { key: "t7", label: fresh("7") },
        { key: "t8", label: fresh("8") },
      ],
      { standard: { t6: null, t7: 36, t8: 120 }, dinner: { t6: 40, t7: 80, t8: 46 } },
    );
    await s.onto(s.d.standard);
    const [t6, t7, t8] = [s.live("t6"), s.live("t7"), s.live("t8")];
    const partyId = await seatAt(t7);
    await s.onto(s.d.dinner);
    expect(await todayRows([t6, t8])).toMatchObject([{ x: null }, { x: 46 }]);
    await setToday(t8, { x: 45 });
    await finish(partyId);
    await readStates();
    expect(await readyOf(t7)).toEqual({ pending: true, readyToMove: true });
    expect(await todayRow(t6)).toMatchObject({ x: null });
    expect(await dueIn(s.d.zoneId)).toBe(0);

    await setToday(t8, { x: 46 });
    expect(await dueIn(s.d.zoneId)).toBe(1);
    await readStates();

    expect(await todayRow(t6)).toMatchObject({ x: 40, takenOff: false });
    expect(await readyOf(t6)).toEqual({ pending: false, readyToMove: false });
  });

  it("a real member taken off the map blocks nothing", async () => {
    await needsClearingEverywhere(false);
    const z = await sixBehindEight([
      { key: "t4", standard: 0, dinner: null },
      { key: "t5", standard: 20, dinner: null },
      { key: "t45", standard: null, dinner: 0, partKeys: ["t4", "t5"] },
    ]);
    const t4 = z.live("t4");
    await setToday(t4, { ...at(40), takenOff: true });
    expect((await readJoined()).get(t4)).not.toBeNull();

    await setToday(z.t8, { x: 120 });
    expect(await dueIn(z.d.zoneId)).toBe(1);
    await readStates();

    expect(await todayRow(z.t6)).toMatchObject({ x: 40 });
    expect(await readyOf(z.t6)).toEqual({ pending: false, readyToMove: false });
  });

  it.each(["Reset to … plan", "Update layout"])(
    "%s keeps a stored table off behind a table the reset keeps in place; a later read puts it down there, as that table needs moving (spec §7.5, No lock)",
    async (path) => {
      await needsClearingEverywhere(false);
      const s = await standardAndDinner(
        [
          { key: "a", label: fresh("A") },
          { key: "b", label: fresh("B") },
          { key: "c", label: fresh("C") },
        ],
        { standard: { a: 0, b: 40, c: null }, dinner: { a: 40, b: 80, c: 0 } },
      );
      await s.onto(s.d.standard);
      const [a, b, c] = [s.live("a"), s.live("b"), s.live("c")];
      await seatAt(b);

      if (path === "Update layout") await s.update(s.d.dinner);
      else await s.onto(s.d.dinner);

      expect(await todayRows([a, b, c])).toMatchObject([{ x: 0 }, { x: 40 }, { x: null }]);
      expect(await readyOf(a)).toEqual({ pending: true, readyToMove: true });
      expect(await readyOf(c)).toEqual({ pending: true, readyToMove: false });

      await readStates();

      expect(await todayRows([a, c])).toMatchObject([{ x: 0 }, { x: 0, takenOff: false }]);
      expect(await readyOf(c)).toEqual({ pending: false, readyToMove: false });
    },
  );
});
