import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Logger } from "./logger.js";
import type { TillConfig } from "./till-config.js";
import { mountBookingsApi } from "./booking-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";

// Real Postgres, not PGlite: this suite is the booking-api write group's RLS + `booking.manage` gate
// proof — both of which PGlite CANNOT show, because every PGlite connection is a superuser that
// bypasses FORCE RLS (CLAUDE.md §4), so a "cross-tenant read returned nothing" or "the gate refused"
// there would be a FALSE pass. Every DB touch below goes through `mountBookingsApi`'s `gated` helper
// (withTenant + asAppUser + authorizeManager) from `suite.admin`, and the assertions are written so
// that dropping `asAppUser` (isolation) or `authorizeManager` (the gate) from `booking-api.ts` turns a
// green test red — the two guard-by-deletion receipts recorded on the blocks below.
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the per-suite counter the sibling RLS suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  cfg: TillConfig;
  /** A live MANAGEMENT session cookie for a `manager` (holds `booking.manage`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (holds nothing — the gate refuses it). */
  staffCookie: string;
}

/**
 * Stand up a fresh provisioned venue (as the owner), build the full `TillConfig` from the real ids
 * `applyVenue` returns, then — as the app role under the tenant, so RLS is exercised — seed a MANAGER
 * (role `manager`) and a STAFF person (role `staff`) and mint a live management session for each. Each
 * test gets its OWN tenant, so its reads are that test's alone and order-independent (CLAUDE.md §4).
 */
async function setupVenue(): Promise<Venue> {
  const venue = await applyVenue(
    planVenue({
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
    }),
    { db: suite.admin },
  );

  const { managerSid, staffSid } = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
    const managerSession = await startManagementSession(tx, {
      tenantId: venue.tenantId,
      personId: mgr.rows[0]!.id,
    });
    const staffSession = await startManagementSession(tx, {
      tenantId: venue.tenantId,
      personId: stf.rows[0]!.id,
    });
    return { managerSid: managerSession.id, staffSid: staffSession.id };
  });

  const cfg: TillConfig = {
    tenantId: brandTenantId(venue.tenantId),
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0] ?? venue.tillId),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };

  return {
    cfg,
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
  };
}

/** One Hono app per venue — `mountBookingsApi` binds ONE tenant via `cfg`, so each venue's routes need
 * their own app (mirrors `purchasing-api.rls.test.ts`). */
function mountApp(cfg: TillConfig): Hono {
  const app = new Hono();
  mountBookingsApi(app, { db: suite.admin, cfg }, noopLog);
  return app;
}

/** Insert an ACTIVE dining table for the venue as the app role (RLS-scoped), returning its id. */
async function seedTable(cfg: TillConfig, label = "12"): Promise<string> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const row = await tx.execute<{ id: string }>(sql`
      insert into dining_tables (tenant_id, location_id, label, active)
      values (current_tenant_id(), ${cfg.locationId}, ${label}, true) returning id`);
    return row.rows[0]!.id;
  });
}

/** JSON POST/PATCH/GET helper carrying `cookie`. */
async function send(
  app: Hono,
  method: "POST" | "PATCH" | "GET",
  path: string,
  cookie: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { cookie };
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

interface BookingRow {
  id: string;
  status: string;
  tabId: string | null;
  bookingTime: string;
  contactName: string;
}

async function listOn(app: Hono, cookie: string, date: string): Promise<BookingRow[]> {
  const res = await send(app, "GET", `/management-api/bookings?date=${date}`, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as BookingRow[];
}

function bookingBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bookingDate: "2026-08-20",
    bookingTime: "20:00",
    partySize: 4,
    contactName: "García",
    ...overrides,
  };
}

async function createBooking(
  app: Hono,
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await send(app, "POST", "/management-api/bookings", cookie, bookingBody(overrides));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("Bookings API over real Postgres (RLS end-to-end)", () => {
  it("isolates bookings across tenants — a by-id lifecycle move cannot reach another tenant's row", async () => {
    // Differential cross-tenant isolation, probed through a BY-ID verb, which is the only shape that
    // isolates on RLS ALONE: `cancelBooking`'s UPDATE filters on `id` + `status` with NO tenant OR
    // location predicate (`bookings.ts` `advanceStatus`), so tenant A reaching tenant B's booking id is
    // stopped by nothing but `withTenant` + `asAppUser` FORCE RLS. (A `listBookings` probe would NOT
    // prove this — it carries its own `location_id` predicate, so two distinct venues' days never
    // overlap even as a superuser; §1 "a measurement where both answers look alike measures nothing".)
    //
    // GUARD-BY-DELETION (asAppUser), run 2026-08-30 against postgres:18 via Testcontainers
    // (TESTCONTAINERS_RYUK_DISABLED=true): removed `await asAppUser(tx);` from `booking-api.ts`'s
    // `gated` helper (the line above `authorizeManager`). This test then FAILED — with the app role's
    // RLS gone, A's cancel of B's booking id ran on the `suite.admin` superuser connection, FOUND B's
    // row and returned 204 (and B's booking was left `cancelled`), so the `toBe(404)` and "B is still
    // booked" assertions flipped green→red. Restored the line and the test passed again; `git diff
    // booking-api.ts` is clean.
    const a = await setupVenue();
    const b = await setupVenue();
    const appA = mountApp(a.cfg);
    const appB = mountApp(b.cfg);

    const idA = await createBooking(appA, a.managerCookie, { contactName: "Tenant A" });
    const idB = await createBooking(appB, b.managerCookie, { contactName: "Tenant B" });

    // A's own day list shows A's booking (a positive control that the happy read works).
    const idsA = (await listOn(appA, a.managerCookie, "2026-08-20")).map((r) => r.id);
    expect(idsA).toContain(idA);

    // A tries to cancel B's booking BY ID: RLS hides B's row from A's tenant scope, so the UPDATE
    // matches nothing and the disambiguating read finds no row → a clean 404, not a silent 204.
    const crossTenant = await send(
      appA,
      "POST",
      `/management-api/bookings/${idB}/cancel`,
      a.managerCookie,
      {},
    );
    expect(crossTenant.status).toBe(404);
    expect((await crossTenant.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "booking.not_found", params: { bookingId: idB } },
    });

    // And B's booking is untouched — still `booked`, proving A's cancel reached nothing.
    const bRow = (await listOn(appB, b.managerCookie, "2026-08-20")).find((r) => r.id === idB);
    expect(bRow?.status).toBe("booked");
  });

  it("runs the manager happy path: create → list → patch → seat → read-back", async () => {
    const { cfg, managerCookie } = await setupVenue();
    const app = mountApp(cfg);
    const tableId = await seedTable(cfg);

    const id = await createBooking(app, managerCookie, {
      tableId,
      contactPhone: "600111222",
      notes: "Window seat",
    });

    // List-by-day shows the new booking, still `booked`.
    const listed = await listOn(app, managerCookie, "2026-08-20");
    const created = listed.find((r) => r.id === id);
    expect(created).toMatchObject({ status: "booked", tabId: null, contactName: "García" });

    // PATCH every updatable field at once (exercises every `screenPatch` present-branch).
    const patchRes = await send(app, "PATCH", `/management-api/bookings/${id}`, managerCookie, {
      bookingDate: "2026-08-20",
      bookingTime: "21:30",
      partySize: 6,
      contactName: "García party",
      contactPhone: "600333444",
      notes: "Now a bigger table",
      tableId,
    });
    expect(patchRes.status).toBe(204);
    const afterPatch = (await listOn(app, managerCookie, "2026-08-20")).find((r) => r.id === id);
    expect(afterPatch).toMatchObject({ bookingTime: "21:30:00", contactName: "García party" });

    // Seat: opens a real TS-1 tab on the booking's table and links it.
    const seatRes = await send(
      app,
      "POST",
      `/management-api/bookings/${id}/seat`,
      managerCookie,
      {},
    );
    expect(seatRes.status).toBe(200);
    const { tabId } = (await seatRes.json()) as { tabId: string };
    expect(tabId).toEqual(expect.any(String));

    // Read-back: the booking is now `seated` and carries the tab id.
    const seated = (await listOn(app, managerCookie, "2026-08-20")).find((r) => r.id === id);
    expect(seated).toMatchObject({ status: "seated", tabId });
  });

  it("seats with an explicit tableId in the body when the booking has none", async () => {
    const { cfg, managerCookie } = await setupVenue();
    const app = mountApp(cfg);
    const tableId = await seedTable(cfg, "7");
    const id = await createBooking(app, managerCookie);

    const seatRes = await send(app, "POST", `/management-api/bookings/${id}/seat`, managerCookie, {
      tableId,
    });
    expect(seatRes.status).toBe(200);
    const seated = (await listOn(app, managerCookie, "2026-08-20")).find((r) => r.id === id);
    expect(seated?.status).toBe("seated");
  });

  it("cancels a booking (204) and reflects it in the day list", async () => {
    const { cfg, managerCookie } = await setupVenue();
    const app = mountApp(cfg);
    const id = await createBooking(app, managerCookie);
    const res = await send(app, "POST", `/management-api/bookings/${id}/cancel`, managerCookie, {});
    expect(res.status).toBe(204);
    const row = (await listOn(app, managerCookie, "2026-08-20")).find((r) => r.id === id);
    expect(row?.status).toBe("cancelled");
  });

  it("marks a booking no-show (204)", async () => {
    const { cfg, managerCookie } = await setupVenue();
    const app = mountApp(cfg);
    const id = await createBooking(app, managerCookie);
    const res = await send(
      app,
      "POST",
      `/management-api/bookings/${id}/no-show`,
      managerCookie,
      {},
    );
    expect(res.status).toBe(204);
    const row = (await listOn(app, managerCookie, "2026-08-20")).find((r) => r.id === id);
    expect(row?.status).toBe("no_show");
  });

  it("completes a seated booking (204)", async () => {
    const { cfg, managerCookie } = await setupVenue();
    const app = mountApp(cfg);
    const tableId = await seedTable(cfg);
    const id = await createBooking(app, managerCookie, { tableId });
    await send(app, "POST", `/management-api/bookings/${id}/seat`, managerCookie, {});
    const res = await send(
      app,
      "POST",
      `/management-api/bookings/${id}/complete`,
      managerCookie,
      {},
    );
    expect(res.status).toBe(204);
    const row = (await listOn(app, managerCookie, "2026-08-20")).find((r) => r.id === id);
    expect(row?.status).toBe("completed");
  });

  it("refuses every booking route to a staff-role session — 403 authorization.not_permitted", async () => {
    // Prove the `booking.manage` gate BY DELETION. A `staff`-role management session holds no
    // `booking.manage`, so `authorizeManager` (inside `gated`) throws `authorization.not_permitted`
    // before any op runs on every route.
    //
    // GUARD-BY-DELETION (authorizeManager), run 2026-08-30 against postgres:18 via Testcontainers
    // (TESTCONTAINERS_RYUK_DISABLED=true): removed the
    //   `await authorizeManager(tx, { managementSessionId: sessionId, permission: BOOKING_WRITE });`
    // call from `booking-api.ts`'s `gated` helper. This test then FAILED — every staff request that
    // expected 403 instead reached its op (POST → 201, GET → 200, the by-id routes → 404/409/204), so
    // the `toBe(403)` assertions flipped green→red. Restored the line and the test passed again;
    // `git diff booking-api.ts` is clean afterwards.
    const { cfg, managerCookie, staffCookie } = await setupVenue();
    const app = mountApp(cfg);
    // A real booking the manager owns, so the staff by-id calls target an id that DOES exist — the
    // refusal is the gate, not a not_found masking it.
    const id = await createBooking(app, managerCookie);

    const expect403 = async (res: Response) => {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    };

    await expect403(
      await send(app, "GET", "/management-api/bookings?date=2026-08-20", staffCookie),
    );
    await expect403(
      await send(app, "POST", "/management-api/bookings", staffCookie, bookingBody()),
    );
    await expect403(
      await send(app, "PATCH", `/management-api/bookings/${id}`, staffCookie, { partySize: 3 }),
    );
    await expect403(
      await send(app, "POST", `/management-api/bookings/${id}/seat`, staffCookie, {}),
    );
    await expect403(
      await send(app, "POST", `/management-api/bookings/${id}/cancel`, staffCookie, {}),
    );
    await expect403(
      await send(app, "POST", `/management-api/bookings/${id}/no-show`, staffCookie, {}),
    );
    await expect403(
      await send(app, "POST", `/management-api/bookings/${id}/complete`, staffCookie, {}),
    );
  });

  it("rejects an unauthenticated request → 401 management_session.required", async () => {
    const { cfg } = await setupVenue();
    const app = mountApp(cfg);
    const res = await send(app, "POST", "/management-api/bookings", "", bookingBody());
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });

  it("rejects a non-positive party size → 400 booking.invalid", async () => {
    const { cfg, managerCookie } = await setupVenue();
    const app = mountApp(cfg);
    const res = await send(
      app,
      "POST",
      "/management-api/bookings",
      managerCookie,
      bookingBody({ partySize: 0 }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "booking.invalid", params: { partySize: 0 } },
    });
  });

  it("rejects an empty PATCH body → 400 management.request_invalid", async () => {
    const { cfg, managerCookie } = await setupVenue();
    const app = mountApp(cfg);
    const id = await createBooking(app, managerCookie);
    const res = await send(app, "PATCH", `/management-api/bookings/${id}`, managerCookie, {});
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "patch" } },
    });
  });

  it("rejects a non-uuid :id → 400 shared.invalid_id", async () => {
    const { cfg, managerCookie } = await setupVenue();
    const app = mountApp(cfg);
    const res = await send(
      app,
      "POST",
      "/management-api/bookings/not-a-uuid/cancel",
      managerCookie,
      {},
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id", params: { kind: "BookingId" } },
    });
  });

  it("rejects an illegal lifecycle transition → 409 booking.invalid_transition", async () => {
    const { cfg, managerCookie } = await setupVenue();
    const app = mountApp(cfg);
    const id = await createBooking(app, managerCookie);
    // A booking is `booked`; only a `seated` one may complete, so this is an illegal move.
    const res = await send(
      app,
      "POST",
      `/management-api/bookings/${id}/complete`,
      managerCookie,
      {},
    );
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "booking.invalid_transition", params: { bookingId: id } },
    });
  });

  it("404s a lifecycle move on an absent booking → booking.not_found", async () => {
    const { cfg, managerCookie } = await setupVenue();
    const app = mountApp(cfg);
    const absent = "00000000-0000-0000-0000-000000000000";
    const res = await send(
      app,
      "POST",
      `/management-api/bookings/${absent}/cancel`,
      managerCookie,
      {},
    );
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "booking.not_found", params: { bookingId: absent } },
    });
  });

  it("400s a missing or malformed date query → management.request_invalid", async () => {
    const { cfg, managerCookie } = await setupVenue();
    const app = mountApp(cfg);
    for (const path of ["/management-api/bookings", "/management-api/bookings?date=2026-13-40"]) {
      const res = await send(app, "GET", path, managerCookie);
      expect(res.status).toBe(400);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "date" } },
      });
    }
  });

  it("400s malformed create-body fields via the request screens", async () => {
    const { cfg, managerCookie } = await setupVenue();
    const app = mountApp(cfg);
    const bad: Record<string, unknown>[] = [
      { bookingDate: "2026-99-99" }, // requirePeriod
      { bookingTime: "7pm" }, // requireTime bad format
      { bookingTime: 2000 }, // requireTime non-string
      { partySize: 2.5 }, // requireInteger non-integer
      { partySize: "four" }, // requireInteger non-number
      { contactName: 42 }, // requireString non-string
      { contactPhone: 600 }, // requireString on optional
      { notes: [] }, // requireString on optional
      { tableId: "not-a-uuid" }, // requireBodyUuid
    ];
    for (const override of bad) {
      const res = await send(
        app,
        "POST",
        "/management-api/bookings",
        managerCookie,
        bookingBody(override),
      );
      expect(res.status).toBe(400);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "management.request_invalid" },
      });
    }
  });
});
