import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { saveZonePlan } from "./floor-plan.js";
import {
  diningTables,
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodaySplitParts,
  floorTodayTables,
  parties,
  partyTables,
} from "@waitron/db";
import { writeClearingWorkflow } from "@waitron/venue-service";
import { asc, eq } from "drizzle-orm";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { partyRevision } from "./floor-today-merges.js";
import { inTx, setupPartyVenue, tableRow, type PartyVenue } from "./testing/party-venue.js";
import { mergeOf, plannedZone, todayRow, zoneRevisionOf } from "./testing/floor-today-venue.js";
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

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

async function ok(answer: Response | Promise<Response>, status = 200): Promise<unknown> {
  const settled = await answer;
  expect(settled.status, await settled.clone().text()).toBe(status);
  return status === 204 ? null : settled.json();
}

async function refusal(answer: Promise<Response>): Promise<{ status: number; body: unknown }> {
  const settled = await answer;
  return { status: settled.status, body: await settled.json() };
}

async function seat(tableId: string): Promise<string> {
  const { partyId } = (await ok(post(`/api/tables/${tableId}/seat`, { guestCount: 2 }))) as {
    partyId: string;
  };
  return partyId;
}

async function revision(partyId: string): Promise<number> {
  return inTx(v, (tx) => partyRevision(tx, partyId));
}

function join(partyId: string, body: Record<string, unknown>): Promise<Response> {
  return post(`/api/parties/${partyId}/join`, body);
}

/** The party the floor read shows at each table, in the order asked. */
async function holders(...tableIds: string[]): Promise<(string | null)[]> {
  const answer = await app.request("/api/tables/state", { headers: { cookie } });
  expect(answer.status, await answer.clone().text()).toBe(200);
  const tables = (await answer.json()) as { id: string; party: { id: string } | null }[];
  return tableIds.map((id) => tables.find((t) => t.id === id)!.party?.id ?? null);
}

async function place(tableId: string) {
  const row = await todayRow(v, tableId);
  return { x: row!.x, y: row!.y, rotation: row!.rotation };
}

async function tables(...entries: { key: string; x: number; fixed?: boolean }[]) {
  const { table } = await plannedZone(
    v,
    entries.map((e) => ({ key: e.key, place: { x: e.x, y: 0 }, fixed: e.fixed ?? false })),
  );
  return table as Record<string, string>;
}

async function freeMerge(movingId: string, targetId: string): Promise<void> {
  await ok(post(`/api/tables/${movingId}/today/merge`, { targetId, side: "right", seats: 8 }), 200);
}

describe("a join that merges", () => {
  it("a seated table dragged onto a free one: the party extends and the two merge", async () => {
    const { a, b } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 });
    const p = await seat(a!);

    await ok(
      join(p, {
        tableId: b,
        expectedPartyRevision: await revision(p),
        otherPartyId: null,
        merge: { moving: a, target: b, side: "left", seats: 8 },
      }),
    );

    expect(await holders(a!, b!)).toEqual([p, p]);
    expect(await place(a!)).toEqual({ x: 12, y: 0, rotation: 0 });
    expect(await place(b!)).toEqual({ x: 20, y: 0, rotation: 0 });
    const merge = await mergeOf(v, a!);
    expect(merge?.seats).toBe(8);
    expect(merge?.members.map((m) => m.tableId)).toEqual([a, b].sort());
  });

  it("a free table dragged onto a seated one joins the party", async () => {
    const { a, b } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 });
    const p = await seat(a!);

    await ok(
      join(p, {
        tableId: b,
        expectedPartyRevision: await revision(p),
        otherPartyId: null,
        merge: { moving: b, target: a, side: "right", seats: 6 },
      }),
    );

    expect(await holders(a!, b!)).toEqual([p, p]);
    expect(await place(b!)).toEqual({ x: 8, y: 0, rotation: 0 });
    expect(await place(a!)).toEqual({ x: 0, y: 0, rotation: 0 });
    expect((await mergeOf(v, b!))?.seats).toBe(6);
  });

  it("two seated tables combine, keeping the bills apart when asked, and merge", async () => {
    const { a, b } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 });
    const p = await seat(a!);
    const q = await seat(b!);

    const answer = (await ok(
      join(q, {
        tableId: a,
        bills: "separate",
        expectedPartyRevision: await revision(q),
        otherPartyId: p,
        expectedOtherPartyRevision: await revision(p),
        merge: { moving: a, target: b, side: "left", seats: 8 },
      }),
    )) as { partyId: string };

    expect(answer.partyId).toBe(q);
    expect(await holders(a!, b!)).toEqual([q, q]);
    const bills = (await ok(app.request(`/api/parties/${q}/bills`, { headers: { cookie } }))) as {
      status: string;
    }[];
    expect(bills.filter((bill) => bill.status === "open")).toHaveLength(2);
    expect((await mergeOf(v, a!))?.joinId).toBe((await mergeOf(v, b!))?.joinId);
    expect(await place(a!)).toEqual({ x: 12, y: 0, rotation: 0 });
  });

  it("a party joined to a table of a free merge holds every table of it", async () => {
    const { a, b, c } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 }, { key: "c", x: 40 });
    await freeMerge(c!, b!);
    const p = await seat(a!);

    await ok(join(p, { tableId: b, expectedPartyRevision: await revision(p), otherPartyId: null }));

    expect(await holders(a!, b!, c!)).toEqual([p, p, p]);
  });

  it("a party moved to a table of a free merge holds every table of it", async () => {
    const { a, c, d } = await tables({ key: "a", x: 0 }, { key: "c", x: 40 }, { key: "d", x: 60 });
    await freeMerge(d!, c!);
    const p = await seat(a!);

    await ok(
      post(`/api/parties/${p}/move`, {
        toTableId: c,
        expectedPartyRevision: await revision(p),
        otherPartyId: null,
      }),
    );

    expect(await holders(a!, c!, d!)).toEqual([null, p, p]);
  });

  it("refuses a merge that names neither the party's table nor the body's, and joins nothing", async () => {
    const { a, b, x } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 }, { key: "x", x: 40 });
    const p = await seat(a!);
    const body = {
      tableId: b,
      expectedPartyRevision: await revision(p),
      otherPartyId: null,
    };

    for (const merge of [
      { moving: x, target: b, side: "left", seats: 8 },
      { moving: b, target: x, side: "left", seats: 8 },
      { moving: b, target: b, side: "left", seats: 8 },
      "b",
      null,
    ]) {
      expect(await refusal(join(p, { ...body, merge })), JSON.stringify(merge)).toEqual({
        status: 400,
        body: { error: { code: "management.request_invalid", params: { field: "merge" } } },
      });
    }
    expect(await holders(a!, b!, x!)).toEqual([p, null, null]);
    expect(await mergeOf(v, b!)).toBeNull();
  });

  it("names each malformed field of a merge, and joins nothing", async () => {
    const { a, b } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 });
    const p = await seat(a!);
    const body = { tableId: b, expectedPartyRevision: await revision(p), otherPartyId: null };
    const invalid = (field: string) => ({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field } } },
    });
    const notFound = (tableId: string) => ({
      status: 404,
      body: { error: { code: "table.not_found", params: { tableId } } },
    });

    for (const [merge, answer] of [
      [{ target: a, side: "left" }, invalid("merge.moving")],
      [{ moving: b, side: "left" }, invalid("merge.target")],
      [{ moving: "nope", target: a, side: "left" }, notFound("nope")],
      [{ moving: b, target: 7, side: "left" }, notFound("7")],
      [{ moving: null, target: a, side: "left" }, notFound("null")],
      [{ moving: b, target: a, side: "middle", seats: 8 }, invalid("merge.side")],
      [{ moving: b, target: a, side: "left", seats: 0 }, invalid("merge.seats")],
      [{ moving: b, target: a, side: "left", seats: 1.5 }, invalid("merge.seats")],
      [{ moving: b, target: a, side: "left", seats: 1000 }, invalid("merge.seats")],
    ] as const) {
      expect(await refusal(join(p, { ...body, merge })), JSON.stringify(merge)).toEqual(answer);
    }
    expect(await holders(a!, b!)).toEqual([p, null]);
    expect(await mergeOf(v, b!)).toBeNull();
  });

  it("undoes the join when the merge is refused", async () => {
    const { a, b } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 });
    const p = await seat(a!);

    expect(
      await refusal(
        join(p, {
          tableId: b,
          expectedPartyRevision: await revision(p),
          otherPartyId: null,
          merge: { moving: b, target: a, side: "right" },
        }),
      ),
    ).toEqual({
      status: 400,
      body: { error: { code: "merge.seats_required", params: {} } },
    });
    expect(await holders(a!, b!)).toEqual([p, null]);
    expect(await place(b!)).toEqual({ x: 20, y: 0, rotation: 0 });
    expect(await mergeOf(v, b!)).toBeNull();
  });
});

describe("a table taken off today", () => {
  it("is refused to a join, and nobody takes it", async () => {
    const { a, b } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 });
    const p = await seat(a!);
    await ok(post(`/api/tables/${b}/today/take-off`, {}), 200);

    expect(
      await refusal(
        join(p, { tableId: b, expectedPartyRevision: await revision(p), otherPartyId: null }),
      ),
    ).toEqual({
      status: 409,
      body: { error: { code: "table.taken_off", params: { tableId: b } } },
    });
    expect(await holders(a!, b!)).toEqual([p, null]);
  });

  it("answers a join's malformed merge before the table taken off", async () => {
    const { a, b, x } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 }, { key: "x", x: 40 });
    const p = await seat(a!);
    await ok(post(`/api/tables/${b}/today/take-off`, {}), 200);

    expect(
      await refusal(
        join(p, {
          tableId: b,
          expectedPartyRevision: await revision(p),
          otherPartyId: null,
          merge: { moving: b, target: x, side: "left", seats: 8 },
        }),
      ),
    ).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "merge" } } },
    });
    expect(await holders(a!, b!, x!)).toEqual([p, null, null]);
  });

  it("is refused to a move, and the party stays where it was", async () => {
    const { a, b } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 });
    const p = await seat(a!);
    await ok(post(`/api/tables/${b}/today/take-off`, {}), 200);

    expect(
      await refusal(
        post(`/api/parties/${p}/move`, {
          toTableId: b,
          expectedPartyRevision: await revision(p),
          otherPartyId: null,
        }),
      ),
    ).toEqual({
      status: 409,
      body: { error: { code: "table.taken_off", params: { tableId: b } } },
    });
    expect(await holders(a!, b!)).toEqual([p, null]);
  });

  it("is refused to a bill moved there, and no party starts on it", async () => {
    const { a, b } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 });
    const { partyId: p, tabId } = (await ok(post(`/api/tables/${a}/seat`, { guestCount: 2 }))) as {
      partyId: string;
      tabId: string;
    };
    await ok(post(`/api/tables/${b}/today/take-off`, {}), 200);

    expect(
      await refusal(
        post(`/api/bills/${tabId}/move`, {
          to: { tableId: b },
          expectedPartyRevision: await revision(p),
          partyId: p,
          otherPartyId: null,
        }),
      ),
    ).toEqual({
      status: 409,
      body: { error: { code: "table.taken_off", params: { tableId: b } } },
    });
    expect(await holders(a!, b!)).toEqual([p, null]);
  });
});

describe("a split that puts the table back", () => {
  it("a split table goes back to where it stood before the merge", async () => {
    const { a, b } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 });
    const p = await seat(a!);
    await ok(
      join(p, {
        tableId: b,
        expectedPartyRevision: await revision(p),
        otherPartyId: null,
        merge: { moving: b, target: a, side: "right", seats: 8 },
      }),
    );
    expect(await place(b!)).toEqual({ x: 8, y: 0, rotation: 0 });

    const split = (await ok(
      post(`/api/parties/${p}/split-table`, {
        tableId: b,
        billId: null,
        expectedPartyRevision: await revision(p),
      }),
    )) as { partyId: string };

    expect(await place(b!)).toEqual({ x: 20, y: 0, rotation: 0 });
    expect(await place(a!)).toEqual({ x: 0, y: 0, rotation: 0 });
    expect(await mergeOf(v, a!)).toBeNull();
    expect(await mergeOf(v, b!)).toBeNull();
    expect(await holders(a!, b!)).toEqual([p, split.partyId]);
  });
});

describe("a fixed table never moves", () => {
  it("a fixed table sent a move anyway is refused by every route, and nothing moves", async () => {
    const { f, m, n } = await tables(
      { key: "f", x: 0, fixed: true },
      { key: "m", x: 20 },
      { key: "n", x: 40 },
    );
    const p = await seat(m!);
    const before = await todayRow(v, f!);
    const fixed = { status: 409, body: { error: { code: "table.fixed", params: { tableId: f } } } };

    expect(await refusal(post(`/api/tables/${f}/today/move`, { x: 100, y: 100 }))).toEqual(fixed);
    expect(await refusal(post(`/api/tables/${f}/today/rotate`, {}))).toEqual(fixed);
    expect(
      await refusal(post(`/api/tables/${f}/today/merge`, { targetId: n, side: "left", seats: 8 })),
    ).toEqual(fixed);
    expect(
      await refusal(post(`/api/tables/${n}/today/merge`, { targetId: f, side: "left", seats: 8 })),
    ).toEqual(fixed);
    expect(
      await refusal(
        join(p, {
          tableId: f,
          expectedPartyRevision: await revision(p),
          otherPartyId: null,
          merge: { moving: f, target: m, side: "left", seats: 8 },
        }),
      ),
    ).toEqual(fixed);

    expect(await holders(f!, m!)).toEqual([null, p]);
    expect(await todayRow(v, f!)).toEqual(before);
    expect(await mergeOf(v, f!)).toBeNull();
  });

  it("a fixed table as the target of a join's merge is refused, and nothing is held or moved", async () => {
    const { f, n } = await tables({ key: "f", x: 0, fixed: true }, { key: "n", x: 20 });
    const p = await seat(f!);
    const before = [await todayRow(v, f!), await todayRow(v, n!)];

    expect(
      await refusal(
        join(p, {
          tableId: n,
          expectedPartyRevision: await revision(p),
          otherPartyId: null,
          merge: { moving: n, target: f, side: "right", seats: 8 },
        }),
      ),
    ).toEqual({ status: 409, body: { error: { code: "table.fixed", params: { tableId: f } } } });
    expect(await holders(f!, n!)).toEqual([p, null]);
    expect([await todayRow(v, f!), await todayRow(v, n!)]).toEqual(before);
    expect(await mergeOf(v, n!)).toBeNull();
  });

  it("joining a fixed table without a merge links the party and moves nothing, and the link ends when it leaves", async () => {
    const { f1, f2 } = await tables(
      { key: "f1", x: 0, fixed: true },
      { key: "f2", x: 20, fixed: true },
    );
    const p = await seat(f1!);
    const before = [await todayRow(v, f1!), await todayRow(v, f2!)];

    await ok(
      join(p, { tableId: f2, expectedPartyRevision: await revision(p), otherPartyId: null }),
    );
    expect(await holders(f1!, f2!)).toEqual([p, p]);
    expect([await todayRow(v, f1!), await todayRow(v, f2!)]).toEqual(before);

    await ok(post(`/api/parties/${p}/finish`, { expectedPartyRevision: await revision(p) }));
    expect(await holders(f1!, f2!)).toEqual([null, null]);
    expect(await mergeOf(v, f1!)).toBeNull();
    expect(await mergeOf(v, f2!)).toBeNull();
  });
});

describe("a join carrying a merge from a stale read", () => {
  it("answers party.out_of_date when the party moved since the read", async () => {
    const { a, b, c } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 }, { key: "c", x: 40 });
    const p = await seat(a!);
    const old = await revision(p);
    await ok(
      post(`/api/parties/${p}/move`, {
        toTableId: c,
        expectedPartyRevision: old,
        otherPartyId: null,
      }),
    );

    const answer = await refusal(
      join(p, {
        tableId: b,
        expectedPartyRevision: old,
        otherPartyId: null,
        merge: { moving: a, target: b, side: "left", seats: 8 },
      }),
    );
    expect(answer.status).toBe(409);
    expect((answer.body as { error: { code: string } }).error.code).toBe("party.out_of_date");
    expect(await holders(a!, b!, c!)).toEqual([null, null, p]);
  });

  it("answers party.not_open when the party has finished", async () => {
    const { a, b } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 });
    const p = await seat(a!);
    await ok(post(`/api/parties/${p}/finish`, { expectedPartyRevision: await revision(p) }));

    const answer = await refusal(
      join(p, {
        tableId: b,
        expectedPartyRevision: await revision(p),
        otherPartyId: null,
        merge: { moving: a, target: b, side: "left", seats: 8 },
      }),
    );
    expect(answer.status).toBe(409);
    expect((answer.body as { error: { code: string } }).error.code).toBe("party.not_open");
    expect(await holders(a!, b!)).toEqual([null, null]);
  });
});

describe("moving guests to one of their own merged tables", () => {
  async function needsClearing(tableId: string): Promise<boolean> {
    const [row] = await inTx(v, (tx) =>
      tx
        .select({ since: diningTables.needsClearingSince })
        .from(diningTables)
        .where(eq(diningTables.id, tableId)),
    );
    return row!.since !== null;
  }

  for (const clearing of [false, true]) {
    it(`shrinks the party to that table and ends the merge (clearing ${clearing ? "on" : "off"})`, async () => {
      await inTx(v, (tx) => writeClearingWorkflow(tx, clearing));
      try {
        const { a, b } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 });
        await freeMerge(a!, b!);
        expect(await place(a!)).toEqual({ x: 28, y: 0, rotation: 0 });
        const p = await seat(a!);
        const old = await revision(p);

        await ok(
          post(`/api/parties/${p}/move`, {
            toTableId: b,
            expectedPartyRevision: old,
            otherPartyId: null,
          }),
        );

        expect(await holders(a!, b!)).toEqual([null, p]);
        expect(await mergeOf(v, a!)).toBeNull();
        expect(await mergeOf(v, b!)).toBeNull();
        expect(await place(a!)).toEqual({ x: 0, y: 0, rotation: 0 });
        expect(await place(b!)).toEqual({ x: 20, y: 0, rotation: 0 });
        expect(await needsClearing(a!)).toBe(clearing);
        expect(await needsClearing(b!)).toBe(false);
        expect(await revision(p)).toBeGreaterThan(old);
      } finally {
        await inTx(v, (tx) => writeClearingWorkflow(tx, false));
      }
    });
  }
});

describe("moving guests off their merge entirely", () => {
  it("leaves the merge standing, free, when the party moves to an unmerged table", async () => {
    const { a, b, c } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 }, { key: "c", x: 60 });
    await freeMerge(a!, b!);
    const p = await seat(a!);
    const merge = await mergeOf(v, a!);
    const placed = [await place(a!), await place(b!)];

    await ok(
      post(`/api/parties/${p}/move`, {
        toTableId: c,
        expectedPartyRevision: await revision(p),
        otherPartyId: null,
      }),
    );

    expect(await holders(a!, b!, c!)).toEqual([null, null, p]);
    expect(await mergeOf(v, a!)).toEqual(merge);
    expect([await place(a!), await place(b!)]).toEqual(placed);
  });

  it("leaves the merge standing, free, when the party moves onto another party's table", async () => {
    const { a, b, d } = await tables({ key: "a", x: 0 }, { key: "b", x: 20 }, { key: "d", x: 60 });
    await freeMerge(a!, b!);
    const p = await seat(a!);
    const q = await seat(d!);
    const merge = await mergeOf(v, a!);
    const placed = [await place(a!), await place(b!)];

    const moved = (await ok(
      post(`/api/parties/${p}/move`, {
        toTableId: d,
        expectedPartyRevision: await revision(p),
        otherPartyId: q,
        expectedOtherPartyRevision: await revision(q),
      }),
    )) as { partyId: string };

    expect(moved.partyId).toBe(q);
    expect(await holders(a!, b!, d!)).toEqual([null, null, q]);
    expect(await mergeOf(v, a!)).toEqual(merge);
    expect([await place(a!), await place(b!)]).toEqual(placed);
  });
});

describe("a party change that changes a room answers its revision", () => {
  /** Three ordinary tables in a fresh room. */
  async function room() {
    const { zoneId, table } = await plannedZone(v, [
      { key: "a", place: { x: 0, y: 0 } },
      { key: "b", place: { x: 20, y: 0 } },
      { key: "c", place: { x: 40, y: 0 } },
    ]);
    return { zoneId, a: table.a!, b: table.b!, c: table.c! };
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
    const parties = await inTx(v, (tx) =>
      tx.select().from(partyTables).orderBy(asc(partyTables.id)),
    );
    return { today, split, joins, joinTables, parties };
  }

  async function mainBill(partyId: string): Promise<string | null> {
    const [row] = await inTx(v, (tx) =>
      tx.select({ mainBillId: parties.mainBillId }).from(parties).where(eq(parties.id, partyId)),
    );
    return row!.mainBillId;
  }

  it("a join with a merge answers the room's new revision", async () => {
    const { zoneId, a, b, c } = await room();
    const p = await seat(a);
    const read = (await zoneRevisionOf(v, zoneId))!;

    const answer = await ok(
      join(p, {
        tableId: b,
        expectedPartyRevision: await revision(p),
        otherPartyId: null,
        merge: { moving: b, target: a, side: "right", seats: 8 },
        zoneRevision: read,
      }),
    );

    expect(answer).toEqual({
      partyId: p,
      mainBillId: await mainBill(p),
      merged: false,
      zoneRevisions: { [zoneId]: read + 1 },
    });
    expect((await zoneRevisionOf(v, zoneId))!).toBe(read + 1);
    expect(await holders(a, b, c)).toEqual([p, p, null]);
  });

  it("a join with a merge sent from an old revision is refused and writes nothing", async () => {
    const { zoneId, a, b, c } = await room();
    const p = await seat(a);
    const read = (await zoneRevisionOf(v, zoneId))!;
    const before = await everything();
    const partyBefore = await revision(p);

    expect(
      await refusal(
        join(p, {
          tableId: b,
          expectedPartyRevision: partyBefore,
          otherPartyId: null,
          merge: { moving: b, target: a, side: "right", seats: 8 },
          zoneRevision: read - 1,
        }),
      ),
    ).toEqual({
      status: 409,
      body: { error: { code: "floor_today.out_of_date", params: { zoneId, revision: read } } },
    });
    expect(await everything()).toEqual(before);
    expect(await revision(p)).toBe(partyBefore);
    expect(await mergeOf(v, b)).toBeNull();
    expect(await holders(a, b, c)).toEqual([p, null, null]);
    expect((await zoneRevisionOf(v, zoneId))!).toBe(read);
  });

  it("a join sent from the read before a catch-up that changes the room is refused, and the catch-up rolled back", async () => {
    const {
      zoneId,
      table,
      master,
      revision: planRevision,
    } = await plannedZone(v, [
      { key: "a", place: { x: 0, y: 0 } },
      { key: "b", place: { x: 20, y: 0 } },
      { key: "c", place: { x: 40, y: 0 } },
    ]);
    const [a, b, c] = [table.a!, table.b!, table.c!];
    const p = await seat(a);
    const q = await seat(c);
    const labels = [(await tableRow(v, a)).label, (await tableRow(v, b)).label];
    const label = (await tableRow(v, c)).label;
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
        revision: planRevision,
        tables: [
          entry("a", labels[0]!, 0),
          entry("b", labels[1]!, 20),
          entry("c", `${label} b`, 40),
        ],
      }),
    );
    await ok(post(`/api/zones/${zoneId}/today/reset`, {}));
    expect((await tableRow(v, c)).label).toBe(label);
    await ok(post(`/api/parties/${q}/finish`, { expectedPartyRevision: await revision(q) }));
    const read = (await zoneRevisionOf(v, zoneId))!;
    const before = await everything();
    const partyBefore = await revision(p);

    expect(
      await refusal(
        join(p, {
          tableId: b,
          expectedPartyRevision: partyBefore,
          otherPartyId: null,
          merge: { moving: b, target: a, side: "right", seats: 8 },
          zoneRevision: read,
        }),
      ),
    ).toEqual({
      status: 409,
      body: { error: { code: "floor_today.out_of_date", params: { zoneId, revision: read + 1 } } },
    });
    expect((await tableRow(v, c)).label).toBe(label);
    expect(await everything()).toEqual(before);
    expect(await revision(p)).toBe(partyBefore);
    expect((await zoneRevisionOf(v, zoneId))!).toBe(read);
  });

  it("a join without a merge sent from an old revision is refused and writes nothing", async () => {
    const { zoneId, a, b, c } = await room();
    const p = await seat(a);
    const read = (await zoneRevisionOf(v, zoneId))!;
    await ok(post(`/api/tables/${c}/today/move`, { x: 60, y: 0 }));
    const before = await everything();
    const partyBefore = await revision(p);

    expect(
      await refusal(
        join(p, {
          tableId: b,
          expectedPartyRevision: partyBefore,
          otherPartyId: null,
          zoneRevision: read,
        }),
      ),
    ).toEqual({
      status: 409,
      body: { error: { code: "floor_today.out_of_date", params: { zoneId, revision: read + 1 } } },
    });
    expect(await everything()).toEqual(before);
    expect(await revision(p)).toBe(partyBefore);
    expect(await holders(a, b, c)).toEqual([p, null, null]);
    expect((await zoneRevisionOf(v, zoneId))!).toBe(read + 1);
  });

  it("a join with a malformed revision is refused", async () => {
    const { zoneId, a, b, c } = await room();
    const p = await seat(a);
    const read = (await zoneRevisionOf(v, zoneId))!;
    const before = await everything();
    const partyBefore = await revision(p);

    expect(
      await refusal(
        join(p, {
          tableId: b,
          expectedPartyRevision: partyBefore,
          otherPartyId: null,
          merge: { moving: b, target: a, side: "right", seats: 8 },
          zoneRevision: "3",
        }),
      ),
    ).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "zoneRevision" } } },
    });
    expect(await everything()).toEqual(before);
    expect(await revision(p)).toBe(partyBefore);
    expect(await holders(a, b, c)).toEqual([p, null, null]);
    expect((await zoneRevisionOf(v, zoneId))!).toBe(read);
  });

  it("a join without a merge answers no zoneRevisions", async () => {
    const { zoneId, a, b, c } = await room();
    const p = await seat(a);
    const read = (await zoneRevisionOf(v, zoneId))!;

    const answer = await ok(
      join(p, { tableId: b, expectedPartyRevision: await revision(p), otherPartyId: null }),
    );

    expect(answer).toEqual({ partyId: p, mainBillId: await mainBill(p), merged: false });
    expect((await zoneRevisionOf(v, zoneId))!).toBe(read);
    expect(await holders(a, b, c)).toEqual([p, p, null]);
  });

  it("Move guests off part of a group ends it and answers the room's new revision", async () => {
    const { zoneId, a, b, c } = await room();
    await freeMerge(a, b);
    const p = await seat(a);
    const read = (await zoneRevisionOf(v, zoneId))!;

    const answer = await ok(
      post(`/api/parties/${p}/move`, {
        toTableId: b,
        expectedPartyRevision: await revision(p),
        otherPartyId: null,
      }),
    );

    expect(answer).toEqual({
      partyId: p,
      mainBillId: await mainBill(p),
      merged: false,
      zoneRevisions: { [zoneId]: read + 1 },
    });
    expect(await mergeOf(v, a)).toBeNull();
    expect(await holders(a, b, c)).toEqual([null, p, null]);
    expect((await zoneRevisionOf(v, zoneId))!).toBe(read + 1);
  });

  it("Split a table that takes a table out of a group answers the room's new revision", async () => {
    const { zoneId, a, b, c } = await room();
    const p = await seat(a);
    await ok(
      join(p, {
        tableId: b,
        expectedPartyRevision: await revision(p),
        otherPartyId: null,
        merge: { moving: b, target: a, side: "right", seats: 8 },
      }),
    );
    const read = (await zoneRevisionOf(v, zoneId))!;

    const split = (await ok(
      post(`/api/parties/${p}/split-table`, {
        tableId: b,
        billId: null,
        expectedPartyRevision: await revision(p),
      }),
    )) as { partyId: string; mainBillId: string | null };

    expect(split).toEqual({
      partyId: split.partyId,
      mainBillId: await mainBill(split.partyId),
      zoneRevisions: { [zoneId]: read + 1 },
    });
    expect(split.partyId).not.toBe(p);
    expect(await mergeOf(v, a)).toBeNull();
    expect(await holders(a, b, c)).toEqual([p, split.partyId, null]);
    expect((await zoneRevisionOf(v, zoneId))!).toBe(read + 1);
  });
});
