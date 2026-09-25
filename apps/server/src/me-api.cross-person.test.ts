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
 * The cross-person identity property on the me routes: a person may only read or change their own
 * record. The requester is the session's person, never a body field, and the person the body names
 * is left untouched. `me-api.test.ts` pins the same property for the locale route.
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

/** Through the table definition: `$defaultFn` generators are never reached by a raw insert. */
async function seedPerson(name: string): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const [row] = await tx
      .insert(persons)
      .values({ displayName: name, pinHash: hashPin("0000"), role: "staff" })
      .returning({ id: persons.id });
    return row!.id;
  });
}

async function cookieFor(personId: string): Promise<string> {
  const session = await withTransaction(suite.db, async (tx) => {
    return startManagementSession(tx, { personId });
  });
  return `${MANAGEMENT_COOKIE}=${session.token}`;
}

/** Through the table definition, for `seedPerson`'s reason. */
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
    // P is signed in; the body names Q as `requestedByPersonId`. A route that read the body would
    // file as Q, and `requestSwap`'s ownership guard would refuse, since the offered shift is P's.
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
    // P is signed in; the body names Q. A stamp on Q would silently cancel an offer Q has not seen.
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

    // A raw-SQL `is not null` projection comes back as 1/0, so it is mapped here.
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
