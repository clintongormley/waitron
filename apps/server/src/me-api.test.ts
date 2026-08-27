import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, startManagementSession } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { SUPPORTED_LOCALES } from "@waitron/shared";
import type { Logger } from "./logger.js";
import { mountMeApi } from "./me-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import "./errors.js";

// PGlite, not real Postgres: the me routes are LOGIC (management session → verb → JSON) over mutable
// planning rows, the browser twin of `schedule-api.ts`. Every DB touch runs through `withTenant` +
// `asAppUser` exactly as production does, but RLS as the deployment role and — the crux — the
// "requester is the SESSION's personId, never the body's" identity property need a real non-superuser
// role to MEAN anything, so they are proven against real Postgres in `me-api.rls.test.ts`. Here we
// prove the route mechanics: whoami, the happy paths, the request-shape 400s and the not-logged-in 401.

const noopLog: Logger = () => {};
let tenantId: string;
let me: string;
let colleague: string;
let manager: string;
// A person carrying an explicit UI-language preference (`persons.locale = 'es-ES'`), for the whoami
// test that proves the route surfaces the SESSION person's own locale. Deliberately DISTINCT from
// `VENUE_LOCALE` ("en-GB") so `{ locale, venueLocale }` are pinned to their two different sources —
// person preference vs venue default — and a mutant swapping them is killed (see whoami test below).
let localed: string;
let locationId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    tenantId = await seedTenant(db);
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Counter', array['es-ES'], 'Retail') returning id`);
    locationId = loc.rows[0]!.id;
    const meRow = await db.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'Me', ${hashPin("1111")}, 'staff') returning id`);
    me = meRow.rows[0]!.id;
    const colRow = await db.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'Colleague', ${hashPin("2222")}, 'staff') returning id`);
    colleague = colRow.rows[0]!.id;
    const mgrRow = await db.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'Manager', ${hashPin("3333")}, 'manager') returning id`);
    manager = mgrRow.rows[0]!.id;
    // A staff person with an explicit `locale` preference (es-ES), distinct from VENUE_LOCALE (en-GB).
    const localedRow = await db.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role, locale)
      values (${tenantId}, 'Localed', ${hashPin("4444")}, 'staff', 'es-ES') returning id`);
    localed = localedRow.rows[0]!.id;
  },
});

// A distinctive `venueLocale` (NOT the ES default) so the public `GET /management-api/locales` test
// proves the route echoes the injected boot value rather than a hardcoded constant. In production
// `boot.ts` derives it via `readVenueLocale`; the me routes only carry it through.
const VENUE_LOCALE = "en-GB";

function mountApp(): Hono {
  const app = new Hono();
  mountMeApi(app, { db: suite.db, cfg: { tenantId }, venueLocale: VENUE_LOCALE }, noopLog);
  return app;
}

/** Open a management session for `personId` (through the production `startManagementSession` path, on
 * the app role) and return the cookie header that carries it — the credential every me route gates on. */
async function cookieFor(personId: string): Promise<string> {
  const session = await withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    return startManagementSession(tx, { tenantId, personId });
  });
  return `${MANAGEMENT_COOKIE}=${session.id}`;
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
  const r = await suite.db.execute<{ id: string }>(sql`
    insert into shifts (tenant_id, person_id, location_id, starts_at, starts_offset_minutes, ends_at, ends_offset_minutes, role)
    values (${tenantId}, ${personId}, ${locationId}, ${startsAt}, 0, ${endsAt}, 0, 'bar') returning id`);
  return r.rows[0]!.id;
}

async function insertSwap(params: {
  requestedBy: string;
  fromShiftId: string;
  toPerson: string;
  status?: string;
}): Promise<string> {
  const r = await suite.db.execute<{ id: string }>(sql`
    insert into shift_swaps (tenant_id, requested_by_person_id, from_shift_id, to_person_id, status)
    values (${tenantId}, ${params.requestedBy}, ${params.fromShiftId}, ${params.toPerson}, ${params.status ?? "requested"})
    returning id`);
  return r.rows[0]!.id;
}

async function insertAbsence(personId: string, startsOn: string, endsOn: string): Promise<string> {
  const r = await suite.db.execute<{ id: string }>(sql`
    insert into absences (tenant_id, person_id, absence_kind, starts_on, ends_on)
    values (${tenantId}, ${personId}, 'holiday', ${startsOn}, ${endsOn}) returning id`);
  return r.rows[0]!.id;
}

describe("mountMeApi — whoami", () => {
  it("GET /management-api/session/me returns { personId, role, locale, venueLocale } for a staff session (role-blind)", async () => {
    const res = await send(mountApp(), "GET", "/management-api/session/me", {
      cookie: await cookieFor(me),
    });
    expect(res.status).toBe(200);
    // `me` carries NO locale preference, so `locale` is null; `venueLocale` is the injected boot
    // default (VENUE_LOCALE), the language the dashboard falls back to when no preference is set.
    expect(
      (await res.json()) as {
        personId: string;
        role: string;
        locale: string | null;
        venueLocale: string;
      },
    ).toEqual({
      personId: me,
      role: "staff",
      locale: null,
      venueLocale: VENUE_LOCALE,
    });
  });

  it("surfaces the SESSION person's own locale preference, distinct from the venue default", async () => {
    // `localed` carries `locale = 'es-ES'`, while `venueLocale` is en-GB — so this pins `locale` to the
    // person's preference and `venueLocale` to the boot default, two DIFFERENT sources. A mutant that
    // returned `deps.venueLocale` for both (or swapped the fields) fails here; the null case above
    // alone could not catch that, since null ≠ any locale string regardless of the source.
    const res = await send(mountApp(), "GET", "/management-api/session/me", {
      cookie: await cookieFor(localed),
    });
    expect(res.status).toBe(200);
    expect(
      (await res.json()) as {
        personId: string;
        role: string;
        locale: string | null;
        venueLocale: string;
      },
    ).toEqual({
      personId: localed,
      role: "staff",
      locale: "es-ES",
      venueLocale: VENUE_LOCALE,
    });
  });

  it("returns the person's real role for a manager session — NEVER runs authorizeManager", async () => {
    // The whoami route is role-blind: it resolves the session and echoes the role, so a manager
    // session answers `manager` and a staff session `staff`, the same route serving both. If the route
    // gated on `authorizeManager` (person.manage), the staff case above would 403 instead of 200.
    const res = await send(mountApp(), "GET", "/management-api/session/me", {
      cookie: await cookieFor(manager),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { role: string }).toMatchObject({ role: "manager" });
  });

  it("401s (management_session.required) when no session cookie is sent", async () => {
    const res = await send(mountApp(), "GET", "/management-api/session/me", { cookie: null });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });

  it("401s (management_session.required) for a well-formed cookie naming no live session", async () => {
    const res = await send(mountApp(), "GET", "/management-api/session/me", {
      cookie: `${MANAGEMENT_COOKIE}=00000000-0000-0000-0000-000000000000`,
    });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });
});

describe("mountMeApi — locales (public)", () => {
  it("GET /management-api/locales returns the supported list + venue default, NO session required", async () => {
    // Deliberately unauthenticated — the dashboard shell fetches it before login. No cookie sent.
    const res = await send(mountApp(), "GET", "/management-api/locales", { cookie: null });
    expect(res.status).toBe(200);
    // The static catalogue verbatim plus the injected boot default (`en-GB` here, proving the route
    // echoes `deps.venueLocale` rather than a constant).
    expect(await res.json()).toEqual({ locales: SUPPORTED_LOCALES, venueDefault: VENUE_LOCALE });
  });
});

describe("mountMeApi — shifts", () => {
  it("GET /management-api/me/schedule/shifts returns the session person's shifts in the window", async () => {
    const shiftId = await insertShift(me, "2026-05-04T09:00:00Z", "2026-05-04T17:00:00Z");
    // A colleague's shift in the same window must NOT appear.
    await insertShift(colleague, "2026-05-04T10:00:00Z", "2026-05-04T18:00:00Z");
    const res = await send(
      mountApp(),
      "GET",
      "/management-api/me/schedule/shifts?from=2026-05-04&to=2026-05-11",
      { cookie: await cookieFor(me) },
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([shiftId]);
  });

  it("401s (management_session.required) when no session cookie is sent", async () => {
    const res = await send(
      mountApp(),
      "GET",
      "/management-api/me/schedule/shifts?from=2026-05-04&to=2026-05-11",
      { cookie: null },
    );
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });

  it("400s a malformed `from` (management.request_invalid, never a 500)", async () => {
    const res = await send(
      mountApp(),
      "GET",
      "/management-api/me/schedule/shifts?from=nope&to=2026-05-11",
      { cookie: await cookieFor(me) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });
});

describe("mountMeApi — swaps", () => {
  it("GET /management-api/me/schedule/swaps returns swaps the person is party to, tagged by direction", async () => {
    const myShift = await insertShift(me, "2026-05-05T09:00:00Z", "2026-05-05T17:00:00Z");
    const theirShift = await insertShift(colleague, "2026-05-06T09:00:00Z", "2026-05-06T17:00:00Z");
    const mine = await insertSwap({ requestedBy: me, fromShiftId: myShift, toPerson: colleague });
    const toMe = await insertSwap({
      requestedBy: colleague,
      fromShiftId: theirShift,
      toPerson: me,
    });
    const res = await send(mountApp(), "GET", "/management-api/me/schedule/swaps", {
      cookie: await cookieFor(me),
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; direction: string }[];
    const byId = new Map(rows.map((r) => [r.id, r.direction]));
    expect(byId.get(mine)).toBe("requested_by_me");
    expect(byId.get(toMe)).toBe("offered_to_me");
  });

  it("POST /management-api/me/schedule/swaps files a give-away as the SESSION's person (201 { swapId })", async () => {
    const myShift = await insertShift(me, "2026-05-07T09:00:00Z", "2026-05-07T17:00:00Z");
    const res = await send(mountApp(), "POST", "/management-api/me/schedule/swaps", {
      cookie: await cookieFor(me),
      // A hostile `requestedByPersonId` in the body is IGNORED — identity comes from the session only
      // (the real-PG identity test proves this by deletion; here we assert the filed row is `me`).
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

  it("POST accepts a two-sided offer with a return shift the colleague owns (201)", async () => {
    const myShift = await insertShift(me, "2026-05-20T09:00:00Z", "2026-05-20T17:00:00Z");
    const theirShift = await insertShift(colleague, "2026-05-21T09:00:00Z", "2026-05-21T17:00:00Z");
    const res = await send(mountApp(), "POST", "/management-api/me/schedule/swaps", {
      cookie: await cookieFor(me),
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
    const res = await send(mountApp(), "POST", "/management-api/me/schedule/swaps", {
      cookie: await cookieFor(me),
      body: null,
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("400s a POST /swaps with a MALFORMED body (management.request_invalid, never a 500)", async () => {
    // `c.req.json()` throws on a malformed body; the shared `readJsonBody` coerces that throw to `{}` →
    // the same field-screen 400 as the null-body test above, not an opaque 500. Sent raw, since `send`
    // would JSON.stringify a valid body.
    const res = await mountApp().request("/management-api/me/schedule/swaps", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: await cookieFor(me) },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("400s a non-UUID fromShiftId (management.request_invalid)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/me/schedule/swaps", {
      cookie: await cookieFor(me),
      body: { fromShiftId: "not-a-uuid", toPersonId: colleague, toShiftId: null },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("403s (swap.not_permitted) offering a from_shift the requester does not own", async () => {
    const theirShift = await insertShift(colleague, "2026-05-08T09:00:00Z", "2026-05-08T17:00:00Z");
    const res = await send(mountApp(), "POST", "/management-api/me/schedule/swaps", {
      cookie: await cookieFor(me),
      body: { fromShiftId: theirShift, toPersonId: colleague, toShiftId: null },
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "swap.not_permitted" },
    });
  });

  it("POST /swaps/:swapId/accept accepts a swap offered to me (204)", async () => {
    const theirShift = await insertShift(colleague, "2026-05-09T09:00:00Z", "2026-05-09T17:00:00Z");
    const swapId = await insertSwap({
      requestedBy: colleague,
      fromShiftId: theirShift,
      toPerson: me,
    });
    const res = await send(
      mountApp(),
      "POST",
      `/management-api/me/schedule/swaps/${swapId}/accept`,
      { cookie: await cookieFor(me) },
    );
    expect(res.status).toBe(204);
    const row = await suite.db.execute<{ status: string }>(
      sql`select status from shift_swaps where id = ${swapId}`,
    );
    expect(row.rows[0]!.status).toBe("accepted");
  });

  it("403s (swap.not_permitted) accepting a swap offered to SOMEONE ELSE", async () => {
    const myShift = await insertShift(me, "2026-05-10T09:00:00Z", "2026-05-10T17:00:00Z");
    const swapId = await insertSwap({ requestedBy: me, fromShiftId: myShift, toPerson: colleague });
    const res = await send(
      mountApp(),
      "POST",
      `/management-api/me/schedule/swaps/${swapId}/accept`,
      { cookie: await cookieFor(me) },
    );
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
    const res = await send(
      mountApp(),
      "POST",
      `/management-api/me/schedule/swaps/${swapId}/accept`,
      { cookie: await cookieFor(me) },
    );
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "swap.not_acceptable" },
    });
  });

  it("404s (swap.not_found) accepting a swap that does not exist", async () => {
    const res = await send(
      mountApp(),
      "POST",
      "/management-api/me/schedule/swaps/00000000-0000-0000-0000-000000000000/accept",
      { cookie: await cookieFor(me) },
    );
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "swap.not_found" },
    });
  });

  it("400s a non-UUID :swapId on accept (shared.invalid_id, never a 500)", async () => {
    const res = await send(
      mountApp(),
      "POST",
      "/management-api/me/schedule/swaps/not-a-uuid/accept",
      { cookie: await cookieFor(me) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });
});

describe("mountMeApi — absences", () => {
  it("GET /management-api/me/schedule/absences returns the person's absences (all statuses)", async () => {
    const absenceId = await insertAbsence(me, "2026-06-01", "2026-06-03");
    await insertAbsence(colleague, "2026-06-01", "2026-06-02"); // not mine
    const res = await send(mountApp(), "GET", "/management-api/me/schedule/absences", {
      cookie: await cookieFor(me),
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toContain(absenceId);
    expect(rows.every((r) => r.id !== undefined)).toBe(true);
  });

  it("POST /management-api/me/schedule/absences files an absence as the SESSION's person (201)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/me/schedule/absences", {
      cookie: await cookieFor(me),
      body: {
        kind: "holiday",
        startsOn: "2026-07-01",
        endsOn: "2026-07-05",
        note: "Time off",
        personId: colleague,
      },
    });
    expect(res.status).toBe(201);
    const { absenceId } = (await res.json()) as { absenceId: string };
    const row = await suite.db.execute<{ person_id: string; status: string; note: string | null }>(
      sql`select person_id, status, note from absences where id = ${absenceId}`,
    );
    expect(row.rows[0]).toEqual({ person_id: me, status: "requested", note: "Time off" });
  });

  it("409s (absence.overlaps) an absence overlapping an existing one for the same person", async () => {
    await insertAbsence(me, "2026-08-10", "2026-08-15");
    const res = await send(mountApp(), "POST", "/management-api/me/schedule/absences", {
      cookie: await cookieFor(me),
      body: { kind: "leave", startsOn: "2026-08-12", endsOn: "2026-08-18", note: null },
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "absence.overlaps" },
    });
  });

  it("400s a POST /absences with a literal null JSON body (management.request_invalid, never a 500)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/me/schedule/absences", {
      cookie: await cookieFor(me),
      body: null,
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("400s an unknown absence kind (management.request_invalid, never an enum 500)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/me/schedule/absences", {
      cookie: await cookieFor(me),
      body: { kind: "sabbatical", startsOn: "2026-09-01", endsOn: "2026-09-02", note: null },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("400s a non-string note (management.request_invalid — nullable, but not a number)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/me/schedule/absences", {
      cookie: await cookieFor(me),
      body: { kind: "holiday", startsOn: "2026-10-01", endsOn: "2026-10-02", note: 42 },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("400s a malformed startsOn (management.request_invalid, never a 22008 500)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/me/schedule/absences", {
      cookie: await cookieFor(me),
      body: { kind: "holiday", startsOn: "2026-02-30", endsOn: "2026-03-02", note: null },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("400s an INVERTED date range (absence.invalid), never a 23514 500", async () => {
    const res = await send(mountApp(), "POST", "/management-api/me/schedule/absences", {
      cookie: await cookieFor(me),
      body: { kind: "holiday", startsOn: "2026-05-10", endsOn: "2026-05-01", note: null },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "absence.invalid" },
    });
  });
});

describe("mountMeApi — set your own locale", () => {
  // Seed a FRESH staff person for each mutating test, so the row this route writes is disposable and no
  // sibling whoami assertion (which pins `me`'s locale to null) is disturbed. The management session is
  // opened via `cookieFor` (the production `startManagementSession` path). Cleaned up in a finally (§4).
  async function freshPerson(pin: string): Promise<string> {
    const row = await suite.db.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'Locale User', ${hashPin(pin)}, 'staff') returning id`);
    return row.rows[0]!.id;
  }
  async function cleanup(personId: string): Promise<void> {
    await suite.db.execute(sql`delete from management_sessions where person_id = ${personId}`);
    await suite.db.execute(sql`delete from persons where id = ${personId}`);
  }

  it("PUT /management-api/session/me/locale 204s and writes the SESSION person's locale", async () => {
    const personId = await freshPerson("4001");
    try {
      const res = await send(mountApp(), "PUT", "/management-api/session/me/locale", {
        cookie: await cookieFor(personId),
        body: { locale: "en-GB" },
      });
      expect(res.status).toBe(204);
      const row = await suite.db.execute<{ locale: string | null }>(
        sql`select locale from persons where id = ${personId}`,
      );
      expect(row.rows[0]!.locale).toBe("en-GB");
    } finally {
      await cleanup(personId);
    }
  });

  it("IGNORES a body personId naming ANOTHER person — only the session's own row changes", async () => {
    // The crux of this surface: identity is the SESSION's person, never a body field. The body names
    // `colleague`, but only the session person's row may change. A route that (wrongly) read
    // `body.personId` would leave the session person untouched AND flip `colleague` — both assertions
    // below catch that (this is the by-deletion proof's target, brief Step 6).
    const sessionPerson = await freshPerson("4002");
    try {
      const before = await suite.db.execute<{ locale: string | null }>(
        sql`select locale from persons where id = ${colleague}`,
      );
      const res = await send(mountApp(), "PUT", "/management-api/session/me/locale", {
        cookie: await cookieFor(sessionPerson),
        body: { locale: "en-GB", personId: colleague },
      });
      expect(res.status).toBe(204);
      // The session person's OWN row changed...
      const mine = await suite.db.execute<{ locale: string | null }>(
        sql`select locale from persons where id = ${sessionPerson}`,
      );
      expect(mine.rows[0]!.locale).toBe("en-GB");
      // ...and the body-named colleague's row did NOT.
      const theirs = await suite.db.execute<{ locale: string | null }>(
        sql`select locale from persons where id = ${colleague}`,
      );
      expect(theirs.rows[0]!.locale).toBe(before.rows[0]!.locale ?? null);
    } finally {
      await cleanup(sessionPerson);
    }
  });

  it("400s (locale.unsupported) an unsupported value", async () => {
    // `me` carries no preference and this rejects before any write, so the shared row is not mutated.
    const res = await send(mountApp(), "PUT", "/management-api/session/me/locale", {
      cookie: await cookieFor(me),
      body: { locale: "ca-ES" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "locale.unsupported" },
    });
  });

  it("400s (locale.unsupported) a missing/null body — coerced to '' → the ONE rejection path", async () => {
    // A `null` JSON body → `?? {}` → an absent `locale` → the `typeof … ? … : ""` coercion → "", which
    // `assertSupportedLocale` rejects as `locale.unsupported`. No separate request-invalid branch — a
    // missing/non-string locale is the same 400 as any other unsupported value.
    const res = await send(mountApp(), "PUT", "/management-api/session/me/locale", {
      cookie: await cookieFor(me),
      body: null,
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "locale.unsupported" },
    });
  });

  it("400s (locale.unsupported) an EMPTY or MALFORMED body, never a 500", async () => {
    // hono's `c.req.json()` THROWS a `SyntaxError` on an empty or malformed body — BEFORE any `?? {}`
    // could run — so without a defensive `.catch` the throw reaches `run` as a NON-AppError and becomes
    // an opaque `server.internal` 500 (the `?? {}` alone only ever caught a literal JSON `null`, proven
    // by the sibling test above). The guarded parse coerces a parse failure to `{}` too, so the body
    // flows through the same `locale` coercion → `""` → the ONE `locale.unsupported` rejection path.
    const app = mountApp();
    const cookie = await cookieFor(me);

    // An EMPTY body (`send` would omit the body and content-type entirely for `undefined`, so call
    // `app.request` directly to send a real empty body under a JSON content-type).
    const empty = await app.request("/management-api/session/me/locale", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: "",
    });
    expect(empty.status).toBe(400);
    expect((await empty.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "locale.unsupported" },
    });

    // A MALFORMED body — sent raw, since `send` would JSON.stringify it into valid JSON.
    const malformed = await app.request("/management-api/session/me/locale", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: "not json",
    });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "locale.unsupported" },
    });
  });
});
