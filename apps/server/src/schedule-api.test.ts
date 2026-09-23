import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, tills, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, loginWithPin, persons } from "@waitron/identity";
import {
  WORKFORCE_MIGRATIONS,
  absences,
  shiftSwaps,
  shifts,
  type ShiftSwapStatus,
} from "@waitron/workforce";
import type { Logger } from "./logger.js";
import { mountScheduleApi } from "./schedule-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import "./errors.js";

// The schedule routes are LOGIC (session → verb → JSON) over mutable planning rows: the route
// mechanics, the request-shape 400s and the not-logged-in 401.
//
// The "requester is the SESSION's personId, never the body's" identity property is proven HERE, by
// deletion: making `schedule-api.ts`'s swap compose prefer `body.requestedByPersonId` reddens
// exactly one case, `expected 403 to be 201` (run 2026-09-22 on node:sqlite). It used to be argued
// that this needed a non-superuser role and so lived in a second real-Postgres suite; there are no
// roles on this engine, that suite is gone, and the property was never a privilege decision.

const noopLog: Logger = () => {};
let tillId: string;
let locationId: string;
let me: string;
let colleague: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    // Seeded through the table definitions, the change `apps/server/src/testing/fiscal-fixtures.ts`
    // took: every `id` here (and `tills.created_at`, `persons.created_at`) is a `$defaultFn`
    // generator on this engine which a raw insert never reaches while the column is NOT NULL, and
    // `invoice_locales` is a JSON array in a text column, so the `array[...]` constructor that
    // filled it was refused with `near "['es-ES']": syntax error`.
    const [loc] = await db
      .insert(locations)
      .values({ name: "Counter", invoiceLocales: ["es-ES"], operationDescription: "Retail" })
      .returning({ id: locations.id });
    locationId = loc!.id;
    const [till] = await db
      .insert(tills)
      .values({ locationId, name: "Till 1" })
      .returning({ id: tills.id });
    tillId = till!.id;
    const [meRow] = await db
      .insert(persons)
      .values({ displayName: "Me", pinHash: hashPin("1111"), role: "staff" })
      .returning({ id: persons.id });
    me = meRow!.id;
    const [colRow] = await db
      .insert(persons)
      .values({ displayName: "Colleague", pinHash: hashPin("2222"), role: "staff" })
      .returning({ id: persons.id });
    colleague = colRow!.id;
  },
});

function mountApp(): Hono {
  const app = new Hono();
  mountScheduleApi(app, { db: suite.db }, noopLog);
  return app;
}

/** Open a real shift session for `personId` (through the production `loginWithPin` path, on the app
 * role) and return the cookie header that carries it — the credential every schedule route gates on. */
async function cookieFor(personId: string, pin: string): Promise<string> {
  const session = await withTransaction(suite.db, async (tx) => {
    return loginWithPin(tx, { tillId, personId, pin });
  });
  return `${SESSION_COOKIE}=${session.id}`;
}

async function send(
  app: Hono,
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie != null) headers["cookie"] = opts.cookie;
  return app.request(path, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

async function insertShift(personId: string, startsAt: string, endsAt: string): Promise<string> {
  const [row] = await suite.db
    .insert(shifts)
    .values({
      personId,
      locationId,
      startsAt,
      startsOffsetMinutes: 0,
      endsAt,
      endsOffsetMinutes: 0,
      role: "bar",
    })
    .returning({ id: shifts.id });
  return row!.id;
}

async function insertSwap(params: {
  requestedBy: string;
  fromShiftId: string;
  toPerson: string;
  status?: ShiftSwapStatus;
}): Promise<string> {
  const [row] = await suite.db
    .insert(shiftSwaps)
    .values({
      requestedByPersonId: params.requestedBy,
      fromShiftId: params.fromShiftId,
      toPersonId: params.toPerson,
      status: params.status ?? "requested",
    })
    .returning({ id: shiftSwaps.id });
  return row!.id;
}

async function insertAbsence(personId: string, startsOn: string, endsOn: string): Promise<string> {
  const [row] = await suite.db
    .insert(absences)
    .values({ personId, kind: "holiday", startsOn, endsOn })
    .returning({ id: absences.id });
  return row!.id;
}

describe("mountScheduleApi — shifts", () => {
  it("GET /api/schedule/shifts returns the logged-in person's shifts in the window", async () => {
    const shiftId = await insertShift(me, "2026-05-04T09:00:00Z", "2026-05-04T17:00:00Z");
    // A colleague's shift in the same window must NOT appear.
    await insertShift(colleague, "2026-05-04T10:00:00Z", "2026-05-04T18:00:00Z");
    const res = await send(
      mountApp(),
      "GET",
      "/api/schedule/shifts?from=2026-05-04&to=2026-05-11",
      {
        cookie: await cookieFor(me, "1111"),
      },
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([shiftId]);
  });

  it("401s (session.required) when no session cookie is sent", async () => {
    const res = await send(
      mountApp(),
      "GET",
      "/api/schedule/shifts?from=2026-05-04&to=2026-05-11",
      {
        cookie: null,
      },
    );
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "session.required" },
    });
  });

  it("400s a malformed `from` (management.request_invalid, never a 500)", async () => {
    const res = await send(mountApp(), "GET", "/api/schedule/shifts?from=nope&to=2026-05-11", {
      cookie: await cookieFor(me, "1111"),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });
});

describe("mountScheduleApi — swaps", () => {
  it("GET /api/schedule/swaps returns swaps the person is party to, tagged by direction", async () => {
    const myShift = await insertShift(me, "2026-05-05T09:00:00Z", "2026-05-05T17:00:00Z");
    const theirShift = await insertShift(colleague, "2026-05-06T09:00:00Z", "2026-05-06T17:00:00Z");
    const mine = await insertSwap({ requestedBy: me, fromShiftId: myShift, toPerson: colleague });
    const toMe = await insertSwap({
      requestedBy: colleague,
      fromShiftId: theirShift,
      toPerson: me,
    });
    const res = await send(mountApp(), "GET", "/api/schedule/swaps", {
      cookie: await cookieFor(me, "1111"),
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; direction: string }[];
    const byId = new Map(rows.map((r) => [r.id, r.direction]));
    expect(byId.get(mine)).toBe("requested_by_me");
    expect(byId.get(toMe)).toBe("offered_to_me");
  });

  it("POST /api/schedule/swaps files a give-away as the SESSION's person (201 { swapId })", async () => {
    const myShift = await insertShift(me, "2026-05-07T09:00:00Z", "2026-05-07T17:00:00Z");
    const res = await send(mountApp(), "POST", "/api/schedule/swaps", {
      cookie: await cookieFor(me, "1111"),
      // A hostile `requestedByPersonId` in the body is IGNORED — identity comes from the session only
      // (`me-api.cross-person.test.ts` proves it by deletion for the sibling DASHBOARD route; here
      // we assert the filed row is `me`).
      body: {
        fromShiftId: myShift,
        toPersonId: colleague,
        toShiftId: null,
        requestedByPersonId: colleague,
      },
    });
    expect(res.status).toBe(201);
    const { swapId } = (await res.json()) as { swapId: string };
    const row = await suite.db.execute<{ requested_by_person_id: string; status: string }>(
      sql`select requested_by_person_id, status from shift_swaps where id = ${swapId}`,
    );
    expect(row.rows[0]).toEqual({ requested_by_person_id: me, status: "requested" });
  });

  it("POST /api/schedule/swaps accepts a two-sided offer with a return shift the colleague owns (201)", async () => {
    // The route also handles a non-null `toShiftId` (the two-sided case the UI defers) — the return leg
    // must be owned by the offered person, so seed a shift for the COLLEAGUE and offer it as the return.
    const myShift = await insertShift(me, "2026-05-20T09:00:00Z", "2026-05-20T17:00:00Z");
    const theirShift = await insertShift(colleague, "2026-05-21T09:00:00Z", "2026-05-21T17:00:00Z");
    const res = await send(mountApp(), "POST", "/api/schedule/swaps", {
      cookie: await cookieFor(me, "1111"),
      body: { fromShiftId: myShift, toPersonId: colleague, toShiftId: theirShift },
    });
    expect(res.status).toBe(201);
    const { swapId } = (await res.json()) as { swapId: string };
    const row = await suite.db.execute<{ to_shift_id: string | null }>(
      sql`select to_shift_id from shift_swaps where id = ${swapId}`,
    );
    expect(row.rows[0]!.to_shift_id).toBe(theirShift);
  });

  it("400s a POST /swaps with a literal null JSON body (management.request_invalid, never a 500)", async () => {
    // A null-parsing body degrades to `{}` (via `readJsonBody`) rather than dereferencing null;
    // the required `fromShiftId` is then absent → a clean 400, never a TypeError 500.
    const res = await send(mountApp(), "POST", "/api/schedule/swaps", {
      cookie: await cookieFor(me, "1111"),
      body: null,
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("400s a POST /swaps with a MALFORMED body (management.request_invalid, never a 500)", async () => {
    // `c.req.json()` throws on a malformed body; `readJsonBody` coerces that throw to `{}` → the same
    // field-screen 400 as the null-body test above, not an opaque 500. Sent raw, since `send` would
    // JSON.stringify a valid body.
    const res = await mountApp().request("/api/schedule/swaps", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: await cookieFor(me, "1111") },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("400s a non-UUID fromShiftId (management.request_invalid)", async () => {
    const res = await send(mountApp(), "POST", "/api/schedule/swaps", {
      cookie: await cookieFor(me, "1111"),
      body: { fromShiftId: "not-a-uuid", toPersonId: colleague, toShiftId: null },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("403s (swap.not_permitted) offering a from_shift the requester does not own", async () => {
    // A shift owned by the COLLEAGUE, offered by ME — requestSwap refuses it.
    const theirShift = await insertShift(colleague, "2026-05-08T09:00:00Z", "2026-05-08T17:00:00Z");
    const res = await send(mountApp(), "POST", "/api/schedule/swaps", {
      cookie: await cookieFor(me, "1111"),
      body: { fromShiftId: theirShift, toPersonId: colleague, toShiftId: null },
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "swap.not_permitted" },
    });
  });

  it("POST /api/schedule/swaps/:swapId/accept accepts a swap offered to me (204)", async () => {
    const theirShift = await insertShift(colleague, "2026-05-09T09:00:00Z", "2026-05-09T17:00:00Z");
    const swapId = await insertSwap({
      requestedBy: colleague,
      fromShiftId: theirShift,
      toPerson: me,
    });
    const res = await send(mountApp(), "POST", `/api/schedule/swaps/${swapId}/accept`, {
      cookie: await cookieFor(me, "1111"),
    });
    expect(res.status).toBe(204);
    const row = await suite.db.execute<{ status: string }>(
      sql`select status from shift_swaps where id = ${swapId}`,
    );
    expect(row.rows[0]!.status).toBe("accepted");
  });

  it("403s (swap.not_permitted) accepting a swap offered to SOMEONE ELSE", async () => {
    const myShift = await insertShift(me, "2026-05-10T09:00:00Z", "2026-05-10T17:00:00Z");
    // Offered to the colleague, not me — I may not accept it.
    const swapId = await insertSwap({ requestedBy: me, fromShiftId: myShift, toPerson: colleague });
    const res = await send(mountApp(), "POST", `/api/schedule/swaps/${swapId}/accept`, {
      cookie: await cookieFor(me, "1111"),
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "swap.not_permitted" },
    });
  });

  it("409s (swap.not_acceptable) accepting a swap that is no longer requested", async () => {
    const theirShift = await insertShift(colleague, "2026-05-11T09:00:00Z", "2026-05-11T17:00:00Z");
    const swapId = await insertSwap({
      requestedBy: colleague,
      fromShiftId: theirShift,
      toPerson: me,
      status: "accepted",
    });
    const res = await send(mountApp(), "POST", `/api/schedule/swaps/${swapId}/accept`, {
      cookie: await cookieFor(me, "1111"),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "swap.not_acceptable" },
    });
  });

  it("404s (swap.not_found) accepting a swap that does not exist", async () => {
    const res = await send(
      mountApp(),
      "POST",
      "/api/schedule/swaps/00000000-0000-0000-0000-000000000000/accept",
      { cookie: await cookieFor(me, "1111") },
    );
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "swap.not_found" },
    });
  });

  it("400s a non-UUID :swapId on accept (shared.invalid_id, never a 500)", async () => {
    const res = await send(mountApp(), "POST", "/api/schedule/swaps/not-a-uuid/accept", {
      cookie: await cookieFor(me, "1111"),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });
});

describe("mountScheduleApi — absences", () => {
  it("GET /api/schedule/absences returns the person's absences (all statuses)", async () => {
    const absenceId = await insertAbsence(me, "2026-06-01", "2026-06-03");
    await insertAbsence(colleague, "2026-06-01", "2026-06-02"); // not mine
    const res = await send(mountApp(), "GET", "/api/schedule/absences", {
      cookie: await cookieFor(me, "1111"),
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toContain(absenceId);
    expect(rows.every((r) => r.id !== undefined)).toBe(true);
  });

  it("POST /api/schedule/absences files an absence as the SESSION's person (201 { absenceId })", async () => {
    const res = await send(mountApp(), "POST", "/api/schedule/absences", {
      cookie: await cookieFor(me, "1111"),
      body: {
        kind: "holiday",
        startsOn: "2026-07-01",
        endsOn: "2026-07-05",
        note: "Vacaciones",
        personId: colleague,
      },
    });
    expect(res.status).toBe(201);
    const { absenceId } = (await res.json()) as { absenceId: string };
    const row = await suite.db.execute<{ person_id: string; status: string; note: string | null }>(
      sql`select person_id, status, note from absences where id = ${absenceId}`,
    );
    expect(row.rows[0]).toEqual({ person_id: me, status: "requested", note: "Vacaciones" });
  });

  it("409s (absence.overlaps) an absence overlapping an existing one for the same person", async () => {
    await insertAbsence(me, "2026-08-10", "2026-08-15");
    const res = await send(mountApp(), "POST", "/api/schedule/absences", {
      cookie: await cookieFor(me, "1111"),
      body: { kind: "leave", startsOn: "2026-08-12", endsOn: "2026-08-18", note: null },
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "absence.overlaps" },
    });
  });

  it("400s a POST /absences with a literal null JSON body (management.request_invalid, never a 500)", async () => {
    // Same `?? {}` degrade-to-empty guard as POST /swaps: the required `kind` is then absent → 400.
    const res = await send(mountApp(), "POST", "/api/schedule/absences", {
      cookie: await cookieFor(me, "1111"),
      body: null,
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("400s an unknown absence kind (management.request_invalid, never an enum 500)", async () => {
    const res = await send(mountApp(), "POST", "/api/schedule/absences", {
      cookie: await cookieFor(me, "1111"),
      body: { kind: "sabbatical", startsOn: "2026-09-01", endsOn: "2026-09-02", note: null },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("400s a non-string note (management.request_invalid — nullable, but not a number)", async () => {
    // `note` is a nullable STRING; a number is neither, so requireNullableString refuses it before the
    // insert. (null and a string are both accepted; this pins the reject branch.)
    const res = await send(mountApp(), "POST", "/api/schedule/absences", {
      cookie: await cookieFor(me, "1111"),
      body: { kind: "holiday", startsOn: "2026-10-01", endsOn: "2026-10-02", note: 42 },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("400s a malformed startsOn (management.request_invalid, never a 22008 500)", async () => {
    const res = await send(mountApp(), "POST", "/api/schedule/absences", {
      cookie: await cookieFor(me, "1111"),
      body: { kind: "holiday", startsOn: "2026-02-30", endsOn: "2026-03-02", note: null },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("400s an INVERTED date range (absence.invalid), never a 23514 500", async () => {
    // The CROSS-field case the impossible-day test above does not reach: startsOn (10 May) and endsOn
    // (1 May) are each a real calendar day, so requirePeriod passes BOTH in isolation — only the PAIR
    // is malformed. createAbsence's ordering guard turns this into a structured 400 `absence.invalid`;
    // without it the insert violates `absences_range_ck` → PG 23514 → a non-AppError → an opaque
    // server.internal 500, the very outcome the screening layer promises never to produce.
    const res = await send(mountApp(), "POST", "/api/schedule/absences", {
      cookie: await cookieFor(me, "1111"),
      body: { kind: "holiday", startsOn: "2026-05-10", endsOn: "2026-05-01", note: null },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "absence.invalid" },
    });
  });
});
