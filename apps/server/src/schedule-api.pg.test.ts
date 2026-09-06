import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin, loginWithPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { mountScheduleApi } from "./schedule-api.js";
import { SESSION_COOKIE } from "./till-session.js";

// Real Postgres, not PGlite: the routes run their DB work as the non-superuser `app_user`, whose
// grants a PGlite superuser connection would hold unconditionally (CLAUDE.md §4).
// THE IDENTITY PROPERTY (the crux of this surface): the requester is the SESSION's person, never a
// body field. A request authenticated as P that puts Q's id in the body still files as P. Proven by
// deletion — make the swap route read `body.requestedByPersonId` instead of the session personId and
// the cross-person assertion below reddens.
// The route mechanics (validation 400s, the domain codes) are proven hermetically in `schedule-api.test.ts`.
const LOCALE = "es-ES";
const suite = useTemplateDb({ template: "manifest" });
const noopLog: Logger = () => {};

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(74_000_000 + nifCounter).padStart(8, "0")}K`;
}

async function setupVenue(): Promise<VenueResult> {
  return applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
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
        },
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );
}

/** Seed a staff person under `tenantId` with a known PIN (on the app role, which holds INSERT on
 * persons). Returns its id. */
async function seedPerson(tenantId: string, name: string, pin: string): Promise<string> {
  return withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    const r = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, ${name}, ${hashPin(pin)}, 'staff') returning id`);
    return r.rows[0]!.id;
  });
}

/** Open a real shift session (through `loginWithPin` on the app role) and return the cookie header. */
async function cookieFor(
  tenantId: string,
  tillId: string,
  personId: string,
  pin: string,
): Promise<string> {
  const session = await withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    return loginWithPin(tx, { tenantId, tillId, personId, pin });
  });
  return `${SESSION_COOKIE}=${session.id}`;
}

/** A shift for `personId`, seeded as admin (superuser) with tenant_id explicit. Returns its id. */
async function seedShift(
  tenantId: string,
  personId: string,
  locationId: string,
  startsAt: string,
  endsAt: string,
): Promise<string> {
  const r = await suite.admin.execute<{ id: string }>(sql`
    insert into shifts (tenant_id, person_id, location_id, starts_at, starts_offset_minutes, ends_at, ends_offset_minutes)
    values (${tenantId}, ${personId}, ${locationId}, ${startsAt}, 0, ${endsAt}, 0) returning id`);
  return r.rows[0]!.id;
}

function mountApp(tenantId: string): Hono {
  const app = new Hono();
  mountScheduleApi(app, { db: suite.admin, cfg: { tenantId } }, noopLog);
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

describe("Schedule API over real Postgres (the identity property: the session's person, never the body's)", () => {
  it("files a swap as the SESSION's person, never the body's — even when the body names someone else", async () => {
    // THE IDENTITY PROPERTY, proven by deletion (run 2026-08-16 against postgres:18 via Testcontainers,
    // TESTCONTAINERS_RYUK_DISABLED=true): P is logged in; the request body hostilely names Q as
    // `requestedByPersonId`. The route ignores the body and files as P (the session), a 201 with
    // `requested_by_person_id = P`. Changing schedule-api.ts's `requestedByPersonId: personId` to read
    // `body.requestedByPersonId` made this test RED: the route then tries to file the request as Q, but
    // the offered shift is P's, so `requestSwap`'s ownership guard 403s where the session-based route
    // 201s (`expected 403 to be 201`). Restored, green. Run as the non-superuser app_user.
    const venue = await setupVenue();
    const p = await seedPerson(venue.tenantId, "P", "1111");
    const q = await seedPerson(venue.tenantId, "Q", "2222");
    const pShift = await seedShift(
      venue.tenantId,
      p,
      venue.locationId,
      "2026-05-04T09:00:00Z",
      "2026-05-04T17:00:00Z",
    );
    const app = mountApp(venue.tenantId);
    const cookieP = await cookieFor(venue.tenantId, venue.tillId, p, "1111");

    const res = await send(app, "POST", "/api/schedule/swaps", cookieP, {
      fromShiftId: pShift,
      toPersonId: q,
      toShiftId: null,
      // Hostile: this must be IGNORED — identity comes from the session, not the body.
      requestedByPersonId: q,
    });
    expect(res.status).toBe(201);
    const { swapId } = (await res.json()) as { swapId: string };

    const row = await suite.admin.execute<{ requested_by_person_id: string }>(
      sql`select requested_by_person_id from shift_swaps where id = ${swapId}`,
    );
    expect(row.rows[0]!.requested_by_person_id).toBe(p); // the session's person, not the body's Q
  });

  it("scopes reads to the session's person — P sees only P's shifts, never Q's", async () => {
    const venue = await setupVenue();
    const p = await seedPerson(venue.tenantId, "P", "1111");
    const q = await seedPerson(venue.tenantId, "Q", "2222");
    const pShift = await seedShift(
      venue.tenantId,
      p,
      venue.locationId,
      "2026-06-01T09:00:00Z",
      "2026-06-01T17:00:00Z",
    );
    await seedShift(
      venue.tenantId,
      q,
      venue.locationId,
      "2026-06-01T10:00:00Z",
      "2026-06-01T18:00:00Z",
    );
    const app = mountApp(venue.tenantId);
    const res = await send(
      app,
      "GET",
      "/api/schedule/shifts?from=2026-06-01&to=2026-06-08",
      await cookieFor(venue.tenantId, venue.tillId, p, "1111"),
    );
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual([pShift]); // only P's, Q's excluded
  });
});
