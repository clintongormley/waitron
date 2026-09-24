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

// A manager holds `booking.manage` only once the module's seat is registered, as boot does.
registerModulePermissions(BOOKINGS_PERMISSIONS);

// `core.openTab` is `fakeCore`: the real verb lives in apps/server, which a module cannot import.
const suite = useVenueDb({ migrations: BOOKINGS_TEST_MIGRATIONS, timeoutMs: 60_000 });

const noopLog: Logger = () => {};

interface Venue {
  cfg: ModuleRouteContext["cfg"];
  /** The route context `BOOKINGS_ROUTES.mount` receives — `core.openTab` bound to this venue. */
  ctx: ModuleRouteContext;
  /** A live MANAGEMENT session cookie for a `manager` (holds `booking.manage`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (no `booking.manage`, so the gate refuses it). */
  staffCookie: string;
}

/** Hand-seeded rather than `applyVenue`, which would import `@waitron/composition`'s `ALL_MODULES`
 * and close a composition → bookings → composition cycle. */
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

function mountApp(ctx: ModuleRouteContext): Hono {
  const app = new Hono();
  BOOKINGS_ROUTES.mount(app, ctx, noopLog);
  return app;
}

async function seedTable(cfg: ModuleRouteContext["cfg"], label = "12"): Promise<string> {
  const [row] = await suite.db
    .insert(diningTables)
    .values({ locationId: cfg.locationId, label, active: true })
    .returning({ id: diningTables.id });
  return row!.id;
}

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
    // The seconds come from `storedTime` (`./bookings.ts`), on an update as on a create.
    expect(afterPatch).toMatchObject({ bookingTime: "21:30:00", contactName: "García party" });

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
    const { ctx, managerCookie, staffCookie } = await setupVenue();
    const app = mountApp(ctx);
    // An id that exists, so the refusal is the gate and not a not_found masking it.
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
    // The screen is the only refusal: the column is plain text and would store `25:61`.
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
    // The dashboard's form sends a blank optional as explicit `null` (`./dashboard/booking-form.ts`).
    // On a create there is no prior value to clear, so `null` means absent.
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

// A mounted route answers through the `run` error boundary as JSON even when it 404s, so an unmounted
// route is told apart by the absence of `application/json`, not by the status alone.
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
    const modules: { routes?: typeof BOOKINGS_ROUTES }[] = [{}];
    const app = new Hono();
    for (const m of modules) m.routes?.mount(app, ctx, noopLog);
    for (const [method, path] of SEVEN) {
      const res = await send(app, method, path, managerCookie, method === "GET" ? undefined : {});
      expect(res.status, `${method} ${path}`).toBe(404);
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
      expect(res.headers.get("content-type") ?? "", `${method} ${path}`).toContain(
        "application/json",
      );
    }
  });
});
