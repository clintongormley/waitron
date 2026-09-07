import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { hashPin, registerModulePermissions, startManagementSession } from "@waitron/identity";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import type { ModuleRouteContext } from "@waitron/module";
import { fakeCore } from "./testing/fake-core.js";
import type { BookingConfig } from "./bookings.js";
import { BOOKINGS_PERMISSIONS } from "./permissions.js";
import { BOOKINGS_ROUTES } from "./routes.js";

// booking.manage is no longer in identity's static catalog (SP1 t4): a `manager` holds it only once
// the module's permissions seat is folded into the ladder. Boot does this via
// registerModulePermissions(ALL_MODULE_PERMISSIONS); here we register the module's OWN seat so the
// manager happy-paths below authorize. Omitting this line flips every manager route to 403
// authorization.not_permitted — the deletion proof for the descriptor's permissions seat.
registerModulePermissions(BOOKINGS_PERMISSIONS);

// Real Postgres, not PGlite: every DB touch below goes through `BOOKINGS_ROUTES`' `gated` helper
// (withTenant + asAppUser + authorizeManager), so the booking routes run as the non-superuser
// `app_user` and the table GRANTS are actually enforced. PGlite connects as a superuser holding every
// privilege (CLAUDE.md §4), so a missing grant would pass there and fail only at runtime. The
// `booking.manage` gate is proven by deletion on the block below. `core.openTab` is `fakeCore` (the
// real verb lives in apps/server, which a module cannot import); the seat still opens a real
// working_orders row, so the seat happy-path and read-back are exercised end to end.

const suite = useTemplateDb({ template: "manifest" });

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

interface Venue {
  cfg: BookingConfig;
  /** The route context `BOOKINGS_ROUTES.mount` receives — `core.openTab` bound to this venue. */
  ctx: ModuleRouteContext;
  /** A live MANAGEMENT session cookie for a `manager` (holds `booking.manage`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (holds nothing — the gate refuses it). */
  staffCookie: string;
}

/** Hand-seed a venue (tenant + location + till + node) and the manager/staff people and sessions this
 * route fixture needs. Not `applyVenue`: that would import `@waitron/composition`'s `ALL_MODULES`,
 * closing a composition → bookings → composition cycle. The tables come from the `manifest` template. */
async function setupVenue(): Promise<Venue> {
  const db: Database = suite.admin;
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Sala principal', array['es-ES'], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));

  const { managerSid, staffSid } = await withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
    const managerSession = await startManagementSession(tx, {
      tenantId,
      personId: mgr.rows[0]!.id,
    });
    const staffSession = await startManagementSession(tx, { tenantId, personId: stf.rows[0]!.id });
    return { managerSid: managerSession.id, staffSid: staffSession.id };
  });

  const cfg: BookingConfig = {
    tenantId: brandTenantId(tenantId),
    locationId: brandLocationId(locationId),
  };
  return {
    cfg,
    ctx: { db, cfg, core: fakeCore({ tenantId, tillId: till.rows[0]!.id, nodeId }) },
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
  };
}

/** One Hono app per venue — the routes bind ONE tenant via `ctx.cfg`, so each venue's routes need
 * their own app (mirrors `purchasing-api.pg.test.ts`). */
function mountApp(ctx: ModuleRouteContext): Hono {
  const app = new Hono();
  BOOKINGS_ROUTES.mount(app, ctx, noopLog);
  return app;
}

/** Insert an ACTIVE dining table for the venue as the app role, returning its id. */
async function seedTable(cfg: BookingConfig, label = "12"): Promise<string> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const row = await tx.execute<{ id: string }>(sql`
      insert into dining_tables (tenant_id, location_id, label, active)
      values (${cfg.tenantId}, ${cfg.locationId}, ${label}, true) returning id`);
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

describe("Bookings API over real Postgres (routes, gates and request screens)", () => {
  it("runs the manager happy path: create → list → patch → seat → read-back", async () => {
    const { ctx, managerCookie } = await setupVenue();
    const app = mountApp(ctx);
    const tableId = await seedTable(ctx.cfg);

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
    const { ctx, managerCookie } = await setupVenue();
    const app = mountApp(ctx);
    const tableId = await seedTable(ctx.cfg, "7");
    const id = await createBooking(app, managerCookie);

    const seatRes = await send(app, "POST", `/management-api/bookings/${id}/seat`, managerCookie, {
      tableId,
    });
    expect(seatRes.status).toBe(200);
    const seated = (await listOn(app, managerCookie, "2026-08-20")).find((r) => r.id === id);
    expect(seated?.status).toBe("seated");
  });

  it("cancels a booking (204) and reflects it in the day list", async () => {
    const { ctx, managerCookie } = await setupVenue();
    const app = mountApp(ctx);
    const id = await createBooking(app, managerCookie);
    const res = await send(app, "POST", `/management-api/bookings/${id}/cancel`, managerCookie, {});
    expect(res.status).toBe(204);
    const row = (await listOn(app, managerCookie, "2026-08-20")).find((r) => r.id === id);
    expect(row?.status).toBe("cancelled");
  });

  it("marks a booking no-show (204)", async () => {
    const { ctx, managerCookie } = await setupVenue();
    const app = mountApp(ctx);
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
    const { ctx, managerCookie } = await setupVenue();
    const app = mountApp(ctx);
    const tableId = await seedTable(ctx.cfg);
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
    // call from `routes.ts`'s `gated` helper. This test then FAILED — every staff request that
    // expected 403 instead reached its op (POST → 201, GET → 200, the by-id routes → 404/409/204), so
    // the `toBe(403)` assertions flipped green→red. Restored the line and the test passed again;
    // `git diff routes.ts` is clean afterwards.
    const { ctx, managerCookie, staffCookie } = await setupVenue();
    const app = mountApp(ctx);
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
    const { ctx } = await setupVenue();
    const app = mountApp(ctx);
    const res = await send(app, "POST", "/management-api/bookings", "", bookingBody());
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });

  it("rejects a non-positive party size → 400 booking.invalid", async () => {
    const { ctx, managerCookie } = await setupVenue();
    const app = mountApp(ctx);
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
    const { ctx, managerCookie } = await setupVenue();
    const app = mountApp(ctx);
    const id = await createBooking(app, managerCookie);
    const res = await send(app, "PATCH", `/management-api/bookings/${id}`, managerCookie, {});
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "patch" } },
    });
  });

  it("rejects a non-uuid :id → 400 shared.invalid_id", async () => {
    const { ctx, managerCookie } = await setupVenue();
    const app = mountApp(ctx);
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
    const { ctx, managerCookie } = await setupVenue();
    const app = mountApp(ctx);
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
    const { ctx, managerCookie } = await setupVenue();
    const app = mountApp(ctx);
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
    const { ctx, managerCookie } = await setupVenue();
    const app = mountApp(ctx);
    for (const path of ["/management-api/bookings", "/management-api/bookings?date=2026-13-40"]) {
      const res = await send(app, "GET", path, managerCookie);
      expect(res.status).toBe(400);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "date" } },
      });
    }
  });

  it("400s malformed create-body fields via the request screens", async () => {
    const { ctx, managerCookie } = await setupVenue();
    const app = mountApp(ctx);
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

  it("400s an out-of-range but well-shaped bookingTime at the screen, never a downstream 500", async () => {
    // `25:61` is `\d{2}:\d{2}`-shaped but out of range: it must be refused as a clean 400
    // `management.request_invalid` by `requireTime`'s range-validating regex BEFORE it reaches the
    // `time` column (where it would `22007` → an opaque `server.internal` 500). A valid `20:00` still
    // creates (201), so the tightened regex has not broken the accepted shape.
    const { ctx, managerCookie } = await setupVenue();
    const app = mountApp(ctx);

    const bad = await send(
      app,
      "POST",
      "/management-api/bookings",
      managerCookie,
      bookingBody({ bookingTime: "25:61" }),
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "bookingTime" } },
    });

    const good = await send(
      app,
      "POST",
      "/management-api/bookings",
      managerCookie,
      bookingBody({ bookingTime: "20:00" }),
    );
    expect(good.status).toBe(201);
  });

  it("accepts an explicit null for the blank optionals a create body carries (the real-form shape)", async () => {
    // The dashboard's booking form sends `contactPhone`/`notes`/`tableId` as explicit `null` when the
    // field is left blank (booking-form.ts `#confirm`: `trim() === "" ? null : …`), the COMMON case. The
    // old `screenCreate` screened each with the NON-nullable `requireString`/`requireBodyUuid` gated on
    // `!== undefined` only, so `requireString(null)` threw `management.request_invalid` → a blank-phone
    // booking created via the real UI 400'd. On a CREATE a `null` blank is equivalent to absent (no prior
    // value to clear), so it must SUCCEED and store the column null.
    const { ctx, managerCookie } = await setupVenue();
    const app = mountApp(ctx);
    const res = await send(app, "POST", "/management-api/bookings", managerCookie, {
      ...bookingBody(),
      contactPhone: null,
      notes: null,
      tableId: null,
    });
    expect(res.status).toBe(201);
    const id = ((await res.json()) as { id: string }).id;

    // Read the row back off the day list and confirm the three optional columns landed null.
    const listRes = await send(
      app,
      "GET",
      "/management-api/bookings?date=2026-08-20",
      managerCookie,
    );
    expect(listRes.status).toBe(200);
    const row = ((await listRes.json()) as Array<Record<string, unknown>>).find((r) => r.id === id);
    expect(row).toMatchObject({
      status: "booked",
      contactPhone: null,
      notes: null,
      tableId: null,
    });
  });
});

// The routes SEAT proven by deletion (CLAUDE.md §4): the descriptor is the only thing that mounts the
// booking routes, so a module list whose bookings descriptor OMITS `routes` mounts nothing and all
// seven paths fall through to Hono's default 404. A mounted route always answers through the `run`
// error boundary (JSON `{ error }`) — even a lifecycle POST on an absent booking, which is a
// booking.not_found 404 with a JSON body — so a lifecycle route's mounted 404 is distinguished from an
// unmounted 404 by the absence of `application/json`, not by the status alone.
describe("routes seat inversion — deletion proof", () => {
  const UUID = "00000000-0000-4000-8000-000000000000";
  const SEVEN: [method: "GET" | "POST" | "PATCH", path: string][] = [
    ["GET", "/management-api/bookings?date=2026-08-20"],
    ["POST", "/management-api/bookings"],
    ["PATCH", `/management-api/bookings/${UUID}`],
    ["POST", `/management-api/bookings/${UUID}/seat`],
    ["POST", `/management-api/bookings/${UUID}/cancel`],
    ["POST", `/management-api/bookings/${UUID}/no-show`],
    ["POST", `/management-api/bookings/${UUID}/complete`],
  ];

  it("with the bookings descriptor's `routes` omitted, all seven routes fall through to a plain 404", async () => {
    const { ctx, managerCookie } = await setupVenue();
    // The generic boot loop over a module list whose bookings descriptor carries NO `routes` seat.
    const modules: { routes?: typeof BOOKINGS_ROUTES }[] = [{}];
    const app = new Hono();
    for (const m of modules) m.routes?.mount(app, ctx, noopLog);
    for (const [method, path] of SEVEN) {
      const res = await send(app, method, path, managerCookie, method === "GET" ? undefined : {});
      expect(res.status, `${method} ${path}`).toBe(404);
      // Not the mounted error boundary (which answers JSON) — Hono's default not-found.
      expect(res.headers.get("content-type") ?? "", `${method} ${path}`).not.toContain(
        "application/json",
      );
    }
  });

  it("positive control: WITH the `routes` seat present, none of the seven is an unmounted 404", async () => {
    const { ctx, managerCookie } = await setupVenue();
    const modules: { routes?: typeof BOOKINGS_ROUTES }[] = [{ routes: BOOKINGS_ROUTES }];
    const app = new Hono();
    for (const m of modules) m.routes?.mount(app, ctx, noopLog);
    for (const [method, path] of SEVEN) {
      const res = await send(app, method, path, managerCookie, method === "GET" ? undefined : {});
      // Every mounted route answers through `run` (JSON), whatever its status — the inverse of above.
      expect(res.headers.get("content-type") ?? "", `${method} ${path}`).toContain(
        "application/json",
      );
    }
  });
});
