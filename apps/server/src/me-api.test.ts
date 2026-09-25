import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { generateSync } from "otplib";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  IDENTITY_MIGRATIONS,
  hashPin,
  registerModulePermissions,
  startManagementSession,
  encryptTotpSecret,
  hashPassword,
  hashSessionToken,
  persons,
  verifyPin,
} from "@waitron/identity";
import {
  WORKFORCE_MIGRATIONS,
  absences,
  shiftSwaps,
  shifts,
  type ShiftSwapStatus,
} from "@waitron/workforce";
import { SUPPORTED_LOCALES } from "@waitron/shared";
import { IDLE_TIMEOUT_MS } from "@waitron/identity";
import type { Logger } from "./logger.js";
import { mountMeApi, type MeApiDeps } from "./me-api.js";
import type { AccountEmail } from "./account-email.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import "./errors.js";

// The route mechanics: whoami, the happy paths, the request-shape 400s and the not-logged-in 401.
// The cross-person identity property is pinned in `me-api.cross-person.test.ts`.

const noopLog: Logger = () => {};
let me: string;
let colleague: string;
let manager: string;
// Carries `locale = 'es-ES'`, distinct from `VENUE_LOCALE`, so `locale` and `venueLocale` are
// pinned to their two different sources.
let localed: string;
let locationId: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    // Through the table definitions: `$defaultFn` generators and the locale list's write mapping
    // are never reached by a raw insert.
    const [loc] = await db
      .insert(locations)
      .values({ name: "Counter", invoiceLocales: ["es-ES"], operationDescription: "Retail" })
      .returning({ id: locations.id });
    locationId = loc!.id;
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
    const [mgrRow] = await db
      .insert(persons)
      .values({ displayName: "Manager", pinHash: hashPin("3333"), role: "manager" })
      .returning({ id: persons.id });
    manager = mgrRow!.id;
    const [localedRow] = await db
      .insert(persons)
      .values({
        displayName: "Localed",
        pinHash: hashPin("4444"),
        role: "staff",
        locale: "es-ES",
      })
      .returning({ id: persons.id });
    localed = localedRow!.id;
  },
});

// Not the ES default, so a route echoing a hardcoded constant fails.
const VENUE_LOCALE = "en-GB";

const NODE_ID = "11111111-1111-4111-8111-111111111111";

const MODULES = ["core", "bookings"];

// As the composition root does at boot, so the manager whoami below carries `booking.manage`.
registerModulePermissions([{ permission: "booking.manage", grantedFrom: "manager" }]);

const PROFILE_KEY_RING = { current: { version: 1, key: Buffer.alloc(32, 6) } };

function mountApp(overrides: Partial<MeApiDeps> = {}): Hono {
  const app = new Hono();
  mountMeApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: NODE_ID },
      venueLocale: VENUE_LOCALE,
      onboardingIntent: "prepare",
      modules: MODULES,
      credentialKeyRing: PROFILE_KEY_RING,
      ...overrides,
    },
    noopLog,
  );
  return app;
}

async function cookieFor(personId: string): Promise<string> {
  const session = await withTransaction(suite.db, async (tx) => {
    return startManagementSession(tx, { personId });
  });
  return `${MANAGEMENT_COOKIE}=${session.token}`;
}

async function send(
  app: Hono,
  method: string,
  path: string,
  opts: {
    body?: unknown;
    cookie?: string | null;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers };
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

describe("mountMeApi — whoami", () => {
  it("GET /management-api/session/me returns identity, locale, venue and module hints for a staff session", async () => {
    const res = await send(mountApp(), "GET", "/management-api/session/me", {
      cookie: await cookieFor(me),
    });
    expect(res.status).toBe(200);
    expect(
      (await res.json()) as {
        personId: string;
        role: string;
        email: string | null;
        locale: string | null;
        venueLocale: string;
        sessionDefault: string;
        venueName: string;
        onboardingIntent: string;
        permissions: string[];
        modules: string[];
        sessionExpiresInSeconds: number;
        sessionIdleTimeoutSeconds: number;
      },
    ).toEqual({
      personId: me,
      role: "staff",
      email: null,
      locale: null,
      venueLocale: VENUE_LOCALE,
      sessionDefault: VENUE_LOCALE,
      venueName: "Test SL",
      onboardingIntent: "prepare",
      permissions: [],
      modules: MODULES,
      sessionExpiresInSeconds: IDLE_TIMEOUT_MS / 1000,
      sessionIdleTimeoutSeconds: IDLE_TIMEOUT_MS / 1000,
    });
  });

  it("never reports a session lifetime above the configured idle timeout", async () => {
    const cookie = await cookieFor(me);
    const token = cookie.slice(`${MANAGEMENT_COOKIE}=`.length);
    // Outside the template: `scripts/postgres-sql-residue.test.ts` reads a `Date.now()` inside a
    // `sql` template as PostgreSQL's `now()`.
    const tenSecondsFromNow = new Date(Date.now() + 10_000).toISOString();
    await suite.db.execute(sql`
      update management_sessions
      set last_seen_at = ${tenSecondsFromNow}
      where token_hash = ${hashSessionToken(token)}`);

    const res = await send(mountApp(), "GET", "/management-api/session/me", { cookie });

    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { sessionExpiresInSeconds: number }).sessionExpiresInSeconds,
    ).toBe(IDLE_TIMEOUT_MS / 1000);
  });

  it("refuses the session row's own id as a dashboard cookie — what a copy of the database holds", async () => {
    const cookie = await cookieFor(me);
    const token = cookie.slice(`${MANAGEMENT_COOKIE}=`.length);
    const { rows } = await suite.db.execute<{ id: string }>(
      sql`select id from management_sessions where token_hash = ${hashSessionToken(token)}`,
    );
    const refused = await send(mountApp(), "GET", "/management-api/session/me", {
      cookie: `${MANAGEMENT_COOKIE}=${rows[0]!.id}`,
    });
    expect(refused.status).toBe(401);
    // The other direction: the cookie's own token still signs in.
    const accepted = await send(mountApp(), "GET", "/management-api/session/me", { cookie });
    expect(accepted.status).toBe(200);
  });

  it("surfaces the SESSION person's own locale preference, distinct from the venue default", async () => {
    const res = await send(mountApp(), "GET", "/management-api/session/me", {
      cookie: await cookieFor(localed),
    });
    expect(res.status).toBe(200);
    expect(
      (await res.json()) as {
        personId: string;
        role: string;
        email: string | null;
        locale: string | null;
        venueLocale: string;
        sessionDefault: string;
        venueName: string;
        onboardingIntent: string;
        permissions: string[];
        modules: string[];
        sessionExpiresInSeconds: number;
        sessionIdleTimeoutSeconds: number;
      },
    ).toEqual({
      personId: localed,
      role: "staff",
      email: null,
      locale: "es-ES",
      venueLocale: VENUE_LOCALE,
      sessionDefault: VENUE_LOCALE,
      venueName: "Test SL",
      onboardingIntent: "prepare",
      permissions: [],
      modules: MODULES,
      sessionExpiresInSeconds: IDLE_TIMEOUT_MS / 1000,
      sessionIdleTimeoutSeconds: IDLE_TIMEOUT_MS / 1000,
    });
  });

  it("returns the person's real role, effective permission set and enabled modules for a manager session — NEVER runs authorizeManager", async () => {
    const res = await send(mountApp(), "GET", "/management-api/session/me", {
      cookie: await cookieFor(manager),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      role: string;
      permissions: string[];
      modules: string[];
    };
    expect(body.role).toBe("manager");
    expect(body.permissions).toContain("booking.manage");
    expect(body.permissions).not.toContain("mirror.create");
    expect(body.modules).toEqual(MODULES);
  });

  // The venue default is es-ES while the browser asks for en-GB, so the two sources are pinned
  // apart.
  it("matches the browser's language for a signed-in person who has never chosen one", async () => {
    const res = await send(
      mountApp({ venueLocale: "es-ES" }),
      "GET",
      "/management-api/session/me",
      {
        cookie: await cookieFor(me),
        headers: { "Accept-Language": "en-GB,en;q=0.9" },
      },
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { sessionDefault: string; venueLocale: string }).toMatchObject({
      sessionDefault: "en-GB",
      venueLocale: "es-ES",
    });
  });

  it("falls back to the venue's language when the browser asks for one we do not ship", async () => {
    const res = await send(
      mountApp({ venueLocale: "es-ES" }),
      "GET",
      "/management-api/session/me",
      {
        cookie: await cookieFor(me),
        headers: { "Accept-Language": "fr-FR" },
      },
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { sessionDefault: string }).toMatchObject({
      sessionDefault: "es-ES",
    });
  });

  it("tells every cache not to store the whoami at all", async () => {
    const res = await send(
      mountApp({ venueLocale: "es-ES" }),
      "GET",
      "/management-api/session/me",
      {
        cookie: await cookieFor(me),
        headers: { "Accept-Language": "en-GB" },
      },
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("varies on the language header so a cache cannot serve one browser's match to another", async () => {
    const res = await send(
      mountApp({ venueLocale: "es-ES" }),
      "GET",
      "/management-api/session/me",
      {
        cookie: await cookieFor(me),
        headers: { "Accept-Language": "en-GB" },
      },
    );
    expect(res.headers.get("Vary")).toBe("Accept-Language");
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

describe("mountMeApi — profile credentials", () => {
  it("passes the TOTP key into a password change for an authenticator-enrolled person", async () => {
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    await suite.db.execute(sql`
      update persons
      set password_hash=${hashPassword("current password")},
          totp_secret=${encryptTotpSecret(secret, PROFILE_KEY_RING.current)}
      where id=${me}`);

    const response = await send(mountApp(), "PUT", "/management-api/session/me/password", {
      cookie: await cookieFor(me),
      body: {
        currentPassword: "current password",
        totp: generateSync({ secret }),
        password: "replacement password",
      },
    });

    expect(response.status).toBe(204);
  });

  it("keeps the old login email until the code sent to the replacement is confirmed", async () => {
    await suite.db.execute(sql`
      update persons set email='old@example.com', pending_email=null,
        password_hash=${hashPassword("current password")}, totp_secret=null where id=${me}`);
    const sent: AccountEmail[] = [];
    const codeKey = Buffer.alloc(32, 21);
    const app = mountApp({
      accountActionCodeKey: codeKey,
      accountActionBaseUrl: "https://waitron.example/",
      sendAccountEmail: async (message) => void sent.push(message),
    });
    const cookie = await cookieFor(me);
    const saved = await send(app, "PUT", "/management-api/session/me/profile", {
      cookie,
      body: {
        displayName: "Me",
        firstNames: "Alex",
        lastNames: "Rivera",
        telephone: null,
        email: "new@example.com",
        locale: "en-GB",
        currentPassword: "current password",
      },
    });
    expect(await saved.json()).toEqual({ emailVerificationSent: true });
    expect(sent).toHaveLength(1);
    const pending = await send(app, "GET", "/management-api/session/me/profile", { cookie });
    expect(await pending.json()).toMatchObject({
      email: "old@example.com",
      pendingEmail: "new@example.com",
    });
    const confirmed = await send(app, "POST", "/management-api/session/me/profile/email/confirm", {
      cookie,
      body: { code: sent[0]!.code },
    });
    expect(await confirmed.json()).toEqual({ email: "new@example.com" });
  });
});

describe("mountMeApi — locales (public)", () => {
  it.each([
    ["en-US,en;q=0.9,es;q=0.8", "en-GB"],
    ["es-MX,es;q=0.9,en;q=0.8", "es-ES"],
    ["es;q=0.2,en;q=0.9", "en-GB"],
    ["fr-FR,de;q=0.9,en;q=0.8", "en-GB"],
    ["EN-us", "en-GB"],
    ["en;q=0,es;q=0.5", "es-ES"],
    ["en,es", "en-GB"],
    ["es,en", "es-ES"],
    ["*", "es-ES"],
    ["*;q=0.8,es;q=0", "en-GB"],
    ["en;q=bogus,es;q=0.5", "es-ES"],
    ["en;q=2,es;q=0.5", "es-ES"],
    ["en;q=-1,es;q=0.5", "es-ES"],
    ["en;q=0.1234,es;q=0.5", "es-ES"],
    ["es;q=0.2,en;q=1.000", "en-GB"],
    ["  en-US ; q=0.8 , es;q=0.2 ", "en-GB"],
    ["fr-FR", "es-ES"],
    ["", "es-ES"],
  ])("matches Accept-Language %j for the public login", async (header, expected) => {
    const res = await mountApp({ venueLocale: "es-ES" }).request("/management-api/locales", {
      headers: { "Accept-Language": header },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ loginDefault: expected, venueDefault: "es-ES" });
    expect(res.headers.get("Vary")).toBe("Accept-Language");
  });

  it("GET /management-api/locales returns the supported list, venue default and venue name without a session", async () => {
    // Unauthenticated: the dashboard shell fetches it before login.
    const res = await send(mountApp(), "GET", "/management-api/locales", { cookie: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      locales: SUPPORTED_LOCALES,
      venueDefault: VENUE_LOCALE,
      loginDefault: VENUE_LOCALE,
      venueName: "Test SL",
      onboardingIntent: "prepare",
    });
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
      // A hostile `requestedByPersonId` in the body is ignored; identity comes from the session.
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
    // Sent raw, since `send` would JSON.stringify a valid body.
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
  // A fresh person per mutating test, so no sibling whoami assertion (which pins `me`'s locale to
  // null) is disturbed.
  async function freshPerson(pin: string): Promise<string> {
    const [row] = await suite.db
      .insert(persons)
      .values({ displayName: "Locale User", pinHash: hashPin(pin), role: "staff" })
      .returning({ id: persons.id });
    return row!.id;
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
    // Identity is the session's person, never a body field: only that person's row may change.
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
      const mine = await suite.db.execute<{ locale: string | null }>(
        sql`select locale from persons where id = ${sessionPerson}`,
      );
      expect(mine.rows[0]!.locale).toBe("en-GB");
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
    const app = mountApp();
    const cookie = await cookieFor(me);

    // `send` would omit an undefined body and its content-type, so send a real empty body directly.
    const empty = await app.request("/management-api/session/me/locale", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: "",
    });
    expect(empty.status).toBe(400);
    expect((await empty.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "locale.unsupported" },
    });

    // Sent raw, since `send` would JSON.stringify it into valid JSON.
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

describe("mountMeApi — own credentials and second factor", () => {
  const PASSWORD = "current password";
  let personCount = 0;

  async function personWithPassword(
    extra: Partial<typeof persons.$inferInsert> = {},
  ): Promise<string> {
    personCount += 1;
    const [row] = await suite.db
      .insert(persons)
      .values({
        displayName: `Credential User ${personCount}`,
        pinHash: hashPin("5555"),
        role: "staff",
        passwordHash: hashPassword(PASSWORD),
        ...extra,
      })
      .returning({ id: persons.id });
    return row!.id;
  }

  async function personRow(personId: string) {
    const [row] = await suite.db.select().from(persons).where(eq(persons.id, personId));
    return row!;
  }

  function capturingApp(overrides: Partial<MeApiDeps> = {}) {
    const lines: Array<[string, string, Record<string, unknown> | undefined]> = [];
    const log: Logger = (level, message, fields) => void lines.push([level, message, fields]);
    const app = new Hono();
    mountMeApi(
      app,
      {
        db: suite.db,
        cfg: { nodeId: NODE_ID },
        venueLocale: VENUE_LOCALE,
        modules: MODULES,
        credentialKeyRing: PROFILE_KEY_RING,
        ...overrides,
      },
      log,
    );
    return { app, lines };
  }

  it("changes the person's own PIN once the current password is confirmed", async () => {
    const personId = await personWithPassword();
    const res = await send(mountApp(), "PUT", "/management-api/session/me/pin", {
      cookie: await cookieFor(personId),
      body: { currentPassword: PASSWORD, pin: "8642" },
    });
    expect(res.status).toBe(204);
    const row = await personRow(personId);
    expect(verifyPin("8642", row.pinHash!)).toBe(true);
    expect(verifyPin("5555", row.pinHash!)).toBe(false);
  });

  it("refuses a PIN change with the wrong current password (401 password.invalid)", async () => {
    const personId = await personWithPassword();
    const res = await send(mountApp(), "PUT", "/management-api/session/me/pin", {
      cookie: await cookieFor(personId),
      body: { currentPassword: "not the password", pin: "8642" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "password.invalid", params: {} } });
    expect(verifyPin("5555", (await personRow(personId)).pinHash!)).toBe(true);
  });

  it("slows a person down after repeated wrong passwords (429 password.throttled)", async () => {
    const personId = await personWithPassword();
    const app = mountApp();
    const cookie = await cookieFor(personId);
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await send(app, "PUT", "/management-api/session/me/pin", {
        cookie,
        body: { currentPassword: "wrong", pin: "8642" },
      });
      expect(res.status).toBe(401);
    }
    const throttled = await send(app, "PUT", "/management-api/session/me/pin", {
      cookie,
      body: { currentPassword: PASSWORD, pin: "8642" },
    });
    expect(throttled.status).toBe(429);
    expect(await throttled.json()).toEqual({
      error: { code: "password.throttled", params: { retryAfterSeconds: 2 } },
    });
  });

  it("does not count a refusal that is not a wrong credential towards the slow-down", async () => {
    const personId = await personWithPassword();
    const app = mountApp();
    const cookie = await cookieFor(personId);
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await send(app, "PUT", "/management-api/session/me/pin", {
        cookie,
        body: { currentPassword: PASSWORD, pin: "1" },
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("pin.too_short");
    }
  });

  it("400s (management.request_invalid) a field that is not a string, naming the field", async () => {
    const personId = await personWithPassword();
    const res = await send(mountApp(), "PUT", "/management-api/session/me/pin", {
      cookie: await cookieFor(personId),
      body: { currentPassword: PASSWORD, pin: 8642 },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "pin" } },
    });
  });

  it("enrols an authenticator, regenerates recovery codes and switches the authenticator off again", async () => {
    const personId = await personWithPassword();
    const app = mountApp();
    const cookie = await cookieFor(personId);

    const begun = await send(app, "POST", "/management-api/session/me/totp/begin", {
      cookie,
      body: { currentPassword: PASSWORD },
    });
    expect(begun.status).toBe(200);
    const enrollment = (await begun.json()) as {
      enrollmentId: string;
      secret: string;
      uri: string;
      expiresAt: string;
    };
    expect(enrollment.uri).toContain(enrollment.secret);
    expect((await personRow(personId)).totpSecret).toBeNull();

    const finished = await send(app, "POST", "/management-api/session/me/totp/finish", {
      cookie,
      body: {
        enrollmentId: enrollment.enrollmentId,
        code: generateSync({ secret: enrollment.secret }),
      },
    });
    expect(finished.status).toBe(200);
    const firstCodes = ((await finished.json()) as { codes: string[] }).codes;
    expect(firstCodes.length).toBeGreaterThan(0);
    expect((await personRow(personId)).totpSecret).not.toBeNull();

    const regenerated = await send(app, "POST", "/management-api/session/me/recovery-codes", {
      cookie,
      body: { currentPassword: PASSWORD, totp: generateSync({ secret: enrollment.secret }) },
    });
    expect(regenerated.status).toBe(200);
    const secondCodes = ((await regenerated.json()) as { codes: string[] }).codes;
    expect(secondCodes).toHaveLength(firstCodes.length);
    expect(secondCodes).not.toEqual(firstCodes);

    const disabled = await send(app, "DELETE", "/management-api/session/me/totp", {
      cookie,
      body: { currentPassword: PASSWORD, totp: generateSync({ secret: enrollment.secret }) },
    });
    expect(disabled.status).toBe(204);
    expect((await personRow(personId)).totpSecret).toBeNull();
  });

  it("401s (totp.invalid) finishing an enrolment with a wrong code, leaving no authenticator", async () => {
    const personId = await personWithPassword();
    const app = mountApp();
    const cookie = await cookieFor(personId);
    const begun = await send(app, "POST", "/management-api/session/me/totp/begin", {
      cookie,
      body: { currentPassword: PASSWORD },
    });
    const { enrollmentId, secret } = (await begun.json()) as {
      enrollmentId: string;
      secret: string;
    };
    // Any fixed code is valid for some secret, so pick one that no step the verifier accepts
    // around now produces for this secret.
    const now = Math.floor(Date.now() / 1000);
    const accepted = new Set(
      [-60, -30, 0, 30, 60].map((offset) => generateSync({ secret, epoch: now + offset })),
    );
    const wrong = ["000000", "111111", "222222", "333333", "444444", "555555"].find(
      (code) => !accepted.has(code),
    )!;

    const res = await send(app, "POST", "/management-api/session/me/totp/finish", {
      cookie,
      body: { enrollmentId, code: wrong },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "totp.invalid", params: {} } });
    expect((await personRow(personId)).totpSecret).toBeNull();
  });

  it("unlinks the person's Google sign-in once the current password is confirmed", async () => {
    const personId = await personWithPassword({ googleSubject: "google-subject-unlink" });
    const res = await send(mountApp(), "DELETE", "/management-api/session/me/google", {
      cookie: await cookieFor(personId),
      body: { currentPassword: PASSWORD },
    });
    expect(res.status).toBe(204);
    expect((await personRow(personId)).googleSubject).toBeNull();
  });

  it("400s (account_action.invalid) an email confirmation code that matches no pending change", async () => {
    const personId = await personWithPassword();
    const res = await send(mountApp(), "POST", "/management-api/session/me/profile/email/confirm", {
      cookie: await cookieFor(personId),
      body: { code: "123456" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "account_action.invalid", params: {} } });
  });

  it.each([
    ["an Error", new Error("mail relay down"), "mail relay down"],
    ["a bare string", "mail relay refused", "mail relay refused"],
  ])(
    "saves the profile but reports no verification email sent when sending throws %s",
    async (_label, thrown, logged) => {
      personCount += 1;
      const personId = await personWithPassword({ email: `before-${personCount}@example.com` });
      const sent: AccountEmail[] = [];
      const { app, lines } = capturingApp({
        sendAccountEmail: async (message) => {
          sent.push(message);
          throw thrown;
        },
      });
      const res = await send(app, "PUT", "/management-api/session/me/profile", {
        cookie: await cookieFor(personId),
        body: {
          displayName: `Credential User ${personCount}`,
          firstNames: "Alex",
          lastNames: "Rivera",
          telephone: null,
          email: `after-${personCount}@example.com`,
          locale: "en-GB",
          currentPassword: PASSWORD,
        },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ emailVerificationSent: false });
      expect(sent).toHaveLength(1);
      expect(sent[0]!.actionUrl).toBe("/");
      expect((await personRow(personId)).pendingEmail).toBe(`after-${personCount}@example.com`);
      expect(lines).toContainEqual([
        "error",
        "account_email.send_failed",
        { purpose: "email_change", error: logged },
      ]);
    },
  );
});
