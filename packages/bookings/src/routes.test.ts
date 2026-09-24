import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { diningTables, locations, tills, withTransaction, type Database } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  hashPin,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import { locationId as brandLocationId } from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import type { ModuleRouteContext } from "@waitron/module";
import { BOOKINGS_TEST_MIGRATIONS } from "./testing/migrations.js";
import { fakeCore } from "./testing/fake-core.js";
import { BOOKINGS_PERMISSIONS } from "./permissions.js";
import { BOOKINGS_ROUTES } from "./routes.js";

// booking.manage is no longer in identity's static catalog (SP1 t4): a `manager` holds it only once
// the module's permissions seat is folded into the ladder. Boot does this via
// registerModulePermissions(ALL_MODULE_PERMISSIONS); here we register the module's OWN seat so the
// manager happy-paths below authorize. Omitting this line flips every manager route to 403
// authorization.not_permitted — the deletion proof for the descriptor's permissions seat.
registerModulePermissions(BOOKINGS_PERMISSIONS);

// WHAT THIS SUITE NO LONGER SHOWS. This engine has no roles, so the GRANT half is gone and nothing
// replaces it. The `booking.manage` gate is the module's own code and is still proven by deletion, on the block
// below. `core.openTab` is `fakeCore` (the real verb lives in apps/server, which a module cannot
// import); the seat still opens a real working_orders row, so the seat happy-path and read-back are
// exercised end to end.
//
// The fixtures apply the whole manifest (BOOKINGS_TEST_MIGRATIONS) — bookings FKs into core, and
// the routes need identity's `persons` and management sessions — where this used to clone the
// shared `manifest` template.
const suite = useVenueDb({ migrations: BOOKINGS_TEST_MIGRATIONS, timeoutMs: 60_000 });

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

interface Venue {
  cfg: ModuleRouteContext["cfg"];
  /** The route context `BOOKINGS_ROUTES.mount` receives — `core.openTab` bound to this venue. */
  ctx: ModuleRouteContext;
  /** A live MANAGEMENT session cookie for a `manager` (holds `booking.manage`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (holds nothing — the gate refuses it). */
  staffCookie: string;
}

/** Hand-seed a venue (tenant + location + till + node) and the manager/staff people and sessions this
 * route fixture needs. Not `applyVenue`: that would import `@waitron/composition`'s `ALL_MODULES`,
 * closing a composition → bookings → composition cycle.
 *
 * Every row goes through its table definition rather than raw SQL: each `id` and each timestamp is
 * supplied by a `$defaultFn` in JavaScript now, never by a column DEFAULT, so a raw insert naming
 * none of them is refused `NOT NULL constraint failed`; and `invoiceLocales` reaches its column's
 * own JSON mapping, which the `array['es-ES']` constructor used to do in SQL this engine has not.
 * The display names carry a fresh suffix because live display names are unique across the database
 * and this fixture runs once per test. */
async function setupVenue(): Promise<Venue> {
  const db: Database = suite.db;
  await seedTenant(db);
  const [loc] = await db
    .insert(locations)
    .values({
      name: "Sala principal",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
    .returning({ id: tills.id });
  const nodeId = await seedNode(db, brandLocationId(locationId));

  const { managerSid, staffSid } = await withTransaction(db, async (tx: Transaction) => {
    const [mgr] = await tx
      .insert(persons)
      .values({
        displayName: `The Manager ${crypto.randomUUID()}`,
        pinHash: hashPin("1234"),
        role: "manager",
      })
      .returning({ id: persons.id });
    const [stf] = await tx
      .insert(persons)
      .values({
        displayName: `The Clerk ${crypto.randomUUID()}`,
        pinHash: hashPin("1234"),
        role: "staff",
      })
      .returning({ id: persons.id });
    const managerSession = await startManagementSession(tx, { personId: mgr!.id });
    const staffSession = await startManagementSession(tx, { personId: stf!.id });
    return { managerSid: managerSession.token, staffSid: staffSession.token };
  });

  const cfg: ModuleRouteContext["cfg"] = {
    locationId: brandLocationId(locationId),
  };
  return {
    cfg,
    ctx: { db, cfg, core: fakeCore({ tillId: till!.id, nodeId }) },
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
  };
}

/** One Hono app per venue — the routes bind ONE tenant via `ctx.cfg`, so each venue's routes need
 * their own app. */
function mountApp(ctx: ModuleRouteContext): Hono {
  const app = new Hono();
  BOOKINGS_ROUTES.mount(app, ctx, noopLog);
  return app;
}

/** Insert an ACTIVE dining table for the venue, returning its id. */
async function seedTable(cfg: ModuleRouteContext["cfg"], label = "12"): Promise<string> {
  const [row] = await suite.db
    .insert(diningTables)
    .values({ locationId: cfg.locationId, label, active: true })
    .returning({ id: diningTables.id });
  return row!.id;
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

describe("Bookings API (routes, gates and request screens)", () => {
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
    // LEFT AS IT WAS, AND THIS CASE IS RED BECAUSE OF IT. `booking_time` was a PostgreSQL `time`,
    // which normalised `21:30` to `21:30:00` on the way back out; `timeOfDay` is plain `text` on
    // this engine (`packages/db/src/schema/columns.ts`), so what is stored and returned is the
    // `21:30` the request sent. Nothing between the route and the column rewrites it — `requireTime`
    // (`./routes.ts`) validates and passes the string through. Changing `21:30:00` to `21:30` is a
    // change to what this case ASSERTS, not a translation of PostgreSQL-only SQL, so it is left for
    // the owner to decide rather than edited to pass.
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
    // GUARD-BY-DELETION (authorizeManager), re-taken on THIS engine 2026-09-22 on Node v26.7.0:
    // removed the
    //   `await authorizeManager(tx, { managementSessionId: sessionId, permission: BOOKING_WRITE });`
    // call from `routes.ts`'s `gated` helper and changed nothing else. This case then FAILED —
    // every staff request that expected 403 instead reached its op — and it was the ONLY case in
    // this file to change state (the happy path above is red either way, for the unrelated reason
    // its own comment gives, and the 401 case stayed green, so the session check is a separate
    // mechanism). Restored, this case passes again. The original reading was taken 2026-08-30
    // against postgres:18 via Testcontainers.
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
    // column. A valid `20:00` still creates (201), so the tightened regex has not broken the
    // accepted shape. Under PostgreSQL the column itself was the backstop — a `time` refused `25:61`
    // with `22007`, so a screen that let it through produced an opaque `server.internal` 500. There
    // is NO backstop now: `timeOfDay` is plain `text` (`packages/db/src/schema/columns.ts`) and
    // would store `25:61` without complaint, which makes the screen the only thing standing here.
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
