import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPassword,
  hashPin,
  persons,
  startManagementSession,
  webauthnCredentials,
} from "@waitron/identity";
import { shifts } from "@waitron/workforce";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountMeApi } from "./me-api.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { ALL_MODULES } from "./modules.js";
import "./errors.js";

/**
 * THE CROSS-PERSON IDENTITY PROPERTY on four me-surface routes, on the engine the box now runs: the
 * requester is the SESSION's person, never a body field, and the person the body names is left
 * UNTOUCHED.
 *
 * ## What this file was, and the one thing that went with PostgreSQL
 *
 * **There are no roles on this engine**: there is no `connectAs`, and every call below runs on the
 * one handle. A missing grant can no longer fail anything here, because there are no grants.
 *
 * ## Which of the two `me-api` suites this is
 *
 * This file is `me-api.cross-person.test.ts`: every case below seeds a SECOND person and drives a
 * route against them — naming them in the request body, or asking whether their rows are visible.
 * `me-api.test.ts` is the single-session half: whoami, the happy paths, the request-shape 400s and
 * the not-logged-in 401. It makes ONE cross-person check of its own, and it is on a route this file
 * does not drive: `IGNORES a body personId naming ANOTHER person`, in its `set your own locale`
 * block, reads `colleague`'s locale before and after `PUT /management-api/session/me/locale` and
 * asserts it is unchanged.
 *
 * The per-suite NIF counter went with the shared container: `useVenueDb` opens one fresh SQLite venue
 * per file and empties it between tests, so the venue provisioned here needs no unique-tax-id dance.
 */
const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const noopLog: Logger = () => {};

describe("your profile", () => {
  it("lets a staff session edit only itself", async () => {
    const personId = await seedPerson("Profile owner");
    const colleagueId = await seedPerson("Colleague");
    await suite.db.execute(
      sql`update persons set email='profile@example.com', password_hash=${hashPassword("current password")} where id=${personId}`,
    );
    const cookie = await cookieFor(personId);
    const app = mountApp();
    const get = await app.request("/management-api/session/me/profile", { headers: { cookie } });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({
      displayName: "Profile owner",
      firstNames: null,
      lastNames: null,
      telephone: null,
      email: "profile@example.com",
      pendingEmail: null,
      locale: null,
      hasPassword: true,
      hasTotp: false,
      hasGoogle: false,
      passkeys: [],
    });
    const saved = await app.request("/management-api/session/me/profile", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        personId: colleagueId,
        role: "admin",
        displayName: "Updated name",
        firstNames: "Updated",
        lastNames: "Owner",
        telephone: "+34 600 000 000",
        email: "profile@example.com",
        locale: "en-GB",
      }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ emailVerificationSent: false });
    const people = await suite.db.execute<{ id: string; display_name: string; role: string }>(
      sql`select id,display_name,role from persons where id in (${personId},${colleagueId})`,
    );
    expect(people.rows).toEqual(
      expect.arrayContaining([
        { id: personId, display_name: "Updated name", role: "staff" },
        { id: colleagueId, display_name: "Colleague", role: "staff" },
      ]),
    );
    expect((await app.request("/management-api/session/me/profile")).status).toBe(401);
    const changed = await app.request("/management-api/session/me/password", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        currentPassword: "current password",
        password: "replacement password",
      }),
    });
    expect(changed.status).toBe(204);
    // Through the table definition, for `seedPerson`'s reason.
    const keys = await suite.db
      .insert(webauthnCredentials)
      .values([
        { personId, credentialId: "profile-own", publicKey: "public" },
        { personId: colleagueId, credentialId: "profile-other", publicKey: "public" },
      ])
      .returning({ id: webauthnCredentials.id, personId: webauthnCredentials.personId });
    const ownKey = keys.find((key) => key.personId === personId)!.id;
    const otherKey = keys.find((key) => key.personId === colleagueId)!.id;
    const remove = (id: string) =>
      app.request(`/management-api/session/me/passkeys/${id}`, {
        method: "DELETE",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: "replacement password" }),
      });
    expect((await remove(otherKey)).status).toBe(404);
    expect((await remove(ownKey)).status).toBe(204);
    const remaining = await suite.db.execute<{ id: string }>(
      sql`select id from webauthn_credentials `,
    );
    expect(remaining.rows).toEqual([{ id: otherKey }]);
  });
});

async function setupVenue(): Promise<VenueResult> {
  return applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "74000001K",
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
}

/**
 * Seed a staff person. Returns its id.
 *
 * Through the table definition, not raw SQL: `persons.id` and `persons.created_at` are JavaScript
 * `$defaultFn` generators on this engine, which a raw insert never reaches while the columns are
 * NOT NULL — the refusal is `NOT NULL constraint failed: persons.id`.
 */
async function seedPerson(name: string): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const [row] = await tx
      .insert(persons)
      .values({ displayName: name, pinHash: hashPin("0000"), role: "staff" })
      .returning({ id: persons.id });
    return row!.id;
  });
}

/** Open a real management session (through `startManagementSession`) and return the cookie
 * header — the credential every me route gates on. */
async function cookieFor(personId: string): Promise<string> {
  const session = await withTransaction(suite.db, async (tx) => {
    return startManagementSession(tx, { personId });
  });
  return `${MANAGEMENT_COOKIE}=${session.token}`;
}

/** A shift for `personId`. Returns its id. Through the table definition, for `seedPerson`'s reason. */
async function seedShift(
  personId: string,
  locationId: string,
  startsAt: string,
  endsAt: string,
): Promise<string> {
  const [row] = await suite.db
    .insert(shifts)
    .values({
      personId,
      locationId,
      startsAt,
      startsOffsetMinutes: 0,
      endsAt,
      endsOffsetMinutes: 0,
    })
    .returning({ id: shifts.id });
  return row!.id;
}

function mountApp(): Hono {
  const app = new Hono();
  // This fixture does not assert sync attribution, so use the default all-zero node id.
  mountMeApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: "11111111-1111-4111-8111-111111111111" },
      venueLocale: "es-ES",
      modules: [],
    },
    noopLog,
  );
  return app;
}

async function send(
  app: Hono,
  method: string,
  path: string,
  cookie: string | null,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie !== null) headers["cookie"] = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("Me API — the identity property: the session's person, never the body's", () => {
  it("files a swap as the SESSION's person, never the body's — even when the body names someone else", async () => {
    // THE IDENTITY PROPERTY, proven by deletion, re-run on this engine 2026-09-22 — the receipt it
    // replaces was taken against postgres:18, which this branch retired. P is signed into the
    // dashboard; the request body hostilely names Q as `requestedByPersonId`. The route ignores the
    // body and files as P, a 201 with `requested_by_person_id = P`. Changing `me-api.ts`'s
    // `requestedByPersonId: personId` to prefer the body's value made ONLY this case red: the route
    // then tries to file as Q, but the offered shift is P's, so `requestSwap`'s ownership guard 403s
    // where the session-based route 201s — `expected 403 to be 201`. Restored from a byte-for-byte
    // copy, verified with `cmp`, and the file passed again.
    const venue = await setupVenue();
    const p = await seedPerson("P");
    const q = await seedPerson("Q");
    const pShift = await seedShift(
      p,
      venue.locationId,
      "2026-05-04T09:00:00Z",
      "2026-05-04T17:00:00Z",
    );
    const app = mountApp();
    const cookieP = await cookieFor(p);

    const res = await send(app, "POST", "/management-api/me/schedule/swaps", cookieP, {
      fromShiftId: pShift,
      toPersonId: q,
      toShiftId: null,
      // Hostile: this must be IGNORED — identity comes from the session, not the body.
      requestedByPersonId: q,
    });
    expect(res.status).toBe(201);
    const { swapId } = (await res.json()) as { swapId: string };

    const row = await suite.db.execute<{ requested_by_person_id: string }>(
      sql`select requested_by_person_id from shift_swaps where id = ${swapId}`,
    );
    expect(row.rows[0]!.requested_by_person_id).toBe(p); // the session's person, not the body's Q
  });

  it("records the passkey offer against the SESSION's person, never the body's", async () => {
    // Same identity property as the swap above, on the route that retires the sign-in passkey offer.
    // P is signed in; the body hostilely names Q. The stamp must land on P and never on Q — a stamp on
    // Q would silently cancel an offer Q has not yet seen.
    //
    // The "untouched Q" half needs no mutation to be meaningful: the route never reads the body at
    // all (`me-api.ts`'s `passkey-offer` handler takes the person from `resolveManagementSession`),
    // so the only way Q could be stamped is a change that introduces the read. What WAS measured on
    // this engine 2026-09-22 is that the STAMP half is not vacuous: deleting the
    // `markPasskeyOffered(tx, { personId })` call reddened this case alone, on the array assertion
    // below — with nobody stamped, P no longer matches `{ id: p, stamped: true }`. Restored from a
    // byte-for-byte copy, verified with `cmp`.
    const p = await seedPerson("P");
    const q = await seedPerson("Q");
    const app = mountApp();

    const anonymous = await send(app, "POST", "/management-api/session/me/passkey-offer", null);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({
      error: { code: "management_session.required" },
    });

    const res = await send(
      app,
      "POST",
      "/management-api/session/me/passkey-offer",
      await cookieFor(p),
      // Hostile: this must be IGNORED — identity comes from the session, not the body.
      { personId: q },
    );
    expect(res.status).toBe(204);

    // The `is not null` projection is raw SQL, so it bypasses drizzle's mappers and this engine hands
    // it back as 1/0 rather than true/false. Mapped HERE, in the reader, so the assertion below is
    // the same assertion it was on PostgreSQL.
    const rows = await suite.db.execute<{ id: string; stamped: number }>(
      sql`select id, (passkey_offered_at is not null) as stamped from persons where id in (${p},${q})`,
    );
    expect(rows.rows.map((row) => ({ id: row.id, stamped: row.stamped === 1 }))).toEqual(
      expect.arrayContaining([
        { id: p, stamped: true }, // the session's person
        { id: q, stamped: false }, // the body's person, untouched
      ]),
    );
  });

  it("whoami and the reads scope to the session's person — P sees only P's shifts, never Q's", async () => {
    const venue = await setupVenue();
    const p = await seedPerson("P");
    const q = await seedPerson("Q");
    const pShift = await seedShift(
      p,
      venue.locationId,
      "2026-06-01T09:00:00Z",
      "2026-06-01T17:00:00Z",
    );
    await seedShift(q, venue.locationId, "2026-06-01T10:00:00Z", "2026-06-01T18:00:00Z");
    const app = mountApp();
    const cookieP = await cookieFor(p);

    // whoami echoes the session's own person + role + locale, never runs authorizeManager (a staff person
    // holds an empty permission set), so P's staff session resolves to `{ personId: P, role: "staff" }`.
    // P has no locale preference, so `locale` is null; `venueLocale` is this app's injected boot default.
    const who = await send(app, "GET", "/management-api/session/me", cookieP);
    expect(who.status).toBe(200);
    expect(
      (await who.json()) as {
        personId: string;
        role: string;
        email: string | null;
        locale: string | null;
        venueLocale: string;
        sessionDefault: string;
        venueName: string;
        sessionExpiresInSeconds: number;
        sessionIdleTimeoutSeconds: number;
        permissions: string[];
        modules: string[];
      },
    ).toEqual({
      personId: p,
      role: "staff",
      email: null,
      sessionExpiresInSeconds: 1800,
      sessionIdleTimeoutSeconds: 1800,
      locale: null,
      venueLocale: "es-ES",
      // No Accept-Language on this request, so the browser match lands on the venue default.
      sessionDefault: "es-ES",
      venueName: "Deli Test SL",
      // A staff person holds no permission; this fixture injects no enabled modules.
      permissions: [],
      modules: [],
    });

    const res = await send(
      app,
      "GET",
      "/management-api/me/schedule/shifts?from=2026-06-01&to=2026-06-08",
      cookieP,
    );
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual([pShift]); // only P's, Q's excluded
  });
});
