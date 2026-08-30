import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, loginWithPin } from "@waitron/identity";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { TenantId } from "@waitron/shared";
import type { Logger, LogLevel } from "./logger.js";
import { createCourse, setProductCourse } from "./kitchen.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

// PGlite, not real Postgres: these routes are wiring — the session guard + isUuid screens + STATUS
// mapping over `fireCourse` / `listStationQueue`, which are LOGIC. The auto-fire arithmetic, the
// held-advance refusal and `fireCourse`'s idempotency are proven at the verb level over a single
// backend in `working-order.test.ts`; RLS / node isolation of `ticket_items` is real-Postgres's job
// (`working-order.rls.test.ts`). This file proves the HTTP SHAPE: the fire route fires a held course,
// the queue read carries each item's `course` + `firedAt`, and the advance route refuses a held item.
// The KDS-3 block at the foot proves the expo (pass) HTTP shape on the SAME seed — the cross-station
// `GET /api/expo/queue` aggregates the node's live orders into courses, and the `ready`/`away` routes
// bump/dispatch a whole course; the aggregation, roll-ups, no-throw-on-empty and `requireCourse`
// semantics are the verbs' (`working-order.test.ts`), the routes only the session guard + id screens.
// The schema is CORE_MIGRATIONS (kitchen_courses / course_id / fired_at / away_at land in the KDS-2/3
// migrations, part of CORE) + IDENTITY_MIGRATIONS (the sessions/persons the login path needs).
let cfg: TillConfig;
let ana: { id: string };
// The two courses seeded on the counter location: Entrantes (earliest, display_order 0) auto-fires;
// Principales (display_order 1) is held until `fireCourse`. Captured at module scope so the fire route
// can name the held course's id and the queue assertions can pin the serialised `course` object.
let entCourseId: string;
let priCourseId: string;

// Distinct `es-ES` descriptions, so a queue item can be matched back to the product it was fired from
// (the queue serialises `descriptions`, not `productId`). `PAN` carries NO course (course: null) — it
// fires immediately like the earliest course (§2b) — proving the null-course serialisation too.
const SOPA = "Sopa"; // Entrantes (earliest) → auto-fires
const FILETE = "Filete"; // Principales (later) → held
const PAN = "Pan"; // no course → fires immediately

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    const tenantId = await seedTenant(db);
    // invoice_locales `es-ES` matches the seeded products' `es-ES` description key — the park/place
    // line-insert fires `check_locales`, which demands a line's `descriptions` keys equal the
    // location's locales exactly.
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Counter', array['es-ES'], 'Retail') returning id`);
    const locationId = brandLocationId(loc.rows[0]!.id);
    // A default kitchen station so the place-time fire (placeOrder → fireLines) has a fallback route.
    await seedKitchenStation(db, { tenantId, locationId });
    const till = await db.execute<{ id: string }>(sql`
      insert into tills (tenant_id, location_id, name)
      values (${tenantId}, ${loc.rows[0]!.id}, 'Till 1') returning id`);
    const nodeId = await seedNode(db, tenantId, locationId);
    const person = await db.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'Ana', ${hashPin("5555")}, 'staff') returning id`);
    ana = { id: person.rows[0]!.id };
    cfg = makeCfg(tenantId, till.rows[0]!.id, loc.rows[0]!.id, nodeId);

    // Seed the courses + three products (two coursed, one loose) on the APP role under the tenant, the
    // same `withTenant` + `asAppUser` path the routes read/write through — so the course FK + the
    // active/assignment filters are real, not bypassed by a superuser insert.
    await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      entCourseId = ent.id;
      priCourseId = pri.id;
      const catalogue = await createCatalogue(tx, { name: "Carta" });
      const category = await createCategory(tx, { name: "Comida" });
      const mk = async (description: string): Promise<string> => {
        const p = await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: category.id,
          descriptions: { "es-ES": description },
          pricingUnit: "each",
          unitPrice: "1.50",
          vatClass: "general",
        });
        return p.id;
      };
      const sopa = await mk(SOPA);
      const filete = await mk(FILETE);
      await mk(PAN); // loose — no course assigned
      await setProductCourse(tx, cfg, sopa, ent.id);
      await setProductCourse(tx, cfg, filete, pri.id);
      await assignCatalogueToLocation(tx, loc.rows[0]!.id, catalogue.id);
    });
  },
});

/** A collecting logger for asserting the structured lines the routes emit. */
function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

/** The till's config for the seeded tenant. `seriesId` is unused (no fiscal write on the coursing/fire
 *  path) so it carries a fresh uuid; `nodeId`/`locationId` are the seeded rows the park/place/queue
 *  routes write and scope by. */
function makeCfg(
  tenantId: TenantId,
  tillId: string,
  locationId: string,
  nodeId: string,
): TillConfig {
  return {
    tenantId,
    tillId: brandTillId(tillId),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

/** The system wall clock — the coursing/fire routes never file a fiscal doc under this `prepay` cfg,
 *  but `placeOrder` calls `clock.now()` regardless of mode, so the same stub shape the sibling suites
 *  use is supplied. */
function systemClock(): TrustedClock {
  return {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("till-api.courses.test: anchor() is not used by the coursing/fire routes");
    },
    currentAnchor: () => null,
  };
}

function deps(db: Database): TillApiDeps {
  return {
    db,
    // Never called: no route this suite drives files a fiscal doc under the `prepay` cfg.
    backend: {} as FiscalBackend,
    clock: systemClock(),
    cfg,
    secureCookies: false,
    venueLocale: "es-ES",
  };
}

/** Opens a real shift session for Ana on the app role — the same `withTenant` + `asAppUser` +
 *  `loginWithPin` path the login route runs — and returns its id. */
async function openSession(db: Database): Promise<string> {
  const session = await withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return loginWithPin(tx, {
      tenantId: cfg.tenantId,
      tillId: cfg.tillId,
      personId: ana.id,
      pin: "5555",
    });
  });
  return session.id;
}

type QueueCourse = { id: string; name: string; displayOrder: number } | null;
type QueueItem = {
  id: string;
  descriptions: Record<string, string>;
  state: string;
  course: QueueCourse;
  firedAt: string | null;
};
type QueueGroup = { orderId: string; items: QueueItem[] };

let app: Hono;
let cookie: string;

beforeAll(async () => {
  app = new Hono();
  mountTillApi(app, deps(suite.db), collect([]));
  cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
});

/** The seeded default station "Cocina", read back through `GET /api/stations`. */
async function cocinaId(): Promise<string> {
  const res = await app.request("/api/stations", { headers: { cookie } });
  expect(res.status).toBe(200);
  const stations = (await res.json()) as { id: string; name: string; isDefault: boolean }[];
  return stations.find((s) => s.isDefault)!.id;
}

/** The order's items at the default station, keyed by their `es-ES` description. */
async function queueItemsByDescription(
  orderId: string,
  station: string,
): Promise<Map<string, QueueItem>> {
  const res = await app.request(`/api/stations/${station}/queue`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const groups = (await res.json()) as QueueGroup[];
  const group = groups.find((g) => g.orderId === orderId)!;
  return new Map(group.items.map((i) => [i.descriptions["es-ES"]!, i]));
}

// The product ids are resolved once (by description) from GET /api/products, so park bodies can name
// them — the queue serialises descriptions, not productId, so this is the only place ids are needed.
// The route now returns `{ menus, products }`; only `products` is needed here.
async function productIdsByDescription(): Promise<Map<string, string>> {
  const res = await app.request("/api/products", { headers: { cookie } });
  expect(res.status).toBe(200);
  const { products } = (await res.json()) as {
    products: { id: string; descriptions: Record<string, string> }[];
  };
  return new Map(products.map((p) => [p.descriptions["es-ES"]!, p.id]));
}

async function placeOrder(descriptions: string[]): Promise<string> {
  const ids = await productIdsByDescription();
  const id = randomUUID();
  const park = await app.request("/api/working-orders", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      id,
      lines: descriptions.map((d) => ({ productId: ids.get(d)!, quantity: "1" })),
    }),
  });
  expect(park.status).toBe(200);
  const place = await app.request(`/api/working-orders/${id}/place`, {
    method: "POST",
    headers: { cookie },
  });
  expect(place.status).toBe(200);
  return id;
}

describe("KDS-2 fire route + station-queue course/firedAt serialisation", () => {
  it("auto-fires the earliest course + the loose line, holds the later course, and the queue carries course + firedAt", async () => {
    const orderId = await placeOrder([SOPA, FILETE, PAN]);
    const station = await cocinaId();
    const items = await queueItemsByDescription(orderId, station);
    expect(items.size).toBe(3);

    // The loose (courseless) line fires immediately and serialises course: null.
    expect(items.get(PAN)!.course).toBeNull();
    expect(items.get(PAN)!.firedAt).not.toBeNull();

    // The earliest course (Entrantes) auto-fires; its item carries the course object + a firedAt.
    expect(items.get(SOPA)!.course).toEqual({
      id: entCourseId,
      name: "Entrantes",
      displayOrder: 0,
    });
    expect(items.get(SOPA)!.firedAt).not.toBeNull();

    // The later course (Principales) is HELD — the object is present but firedAt is null (greyed).
    expect(items.get(FILETE)!.course).toEqual({
      id: priCourseId,
      name: "Principales",
      displayOrder: 1,
    });
    expect(items.get(FILETE)!.firedAt).toBeNull();
  });

  it("a HELD item cannot advance (409 ticket.item_held); firing its course releases it, and it then advances", async () => {
    const orderId = await placeOrder([SOPA, FILETE]);
    const station = await cocinaId();
    const heldItemId = (await queueItemsByDescription(orderId, station)).get(FILETE)!.id;

    // Before firing: the held item is non-advanceable — the kitchen must not bump food not yet started.
    const held = await app.request(`/api/ticket-items/${heldItemId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ to: "preparing" }),
    });
    expect(held.status).toBe(409);
    expect(await held.json()).toMatchObject({
      error: { code: "ticket.item_held", params: { ticketItemId: heldItemId } },
    });

    // Fire the held course → 200; the queue now shows the item fired.
    const fire = await app.request(`/api/orders/${orderId}/courses/${priCourseId}/fire`, {
      method: "POST",
      headers: { cookie },
    });
    expect(fire.status).toBe(200);
    expect(await fire.text()).toBe("");
    expect((await queueItemsByDescription(orderId, station)).get(FILETE)!.firedAt).not.toBeNull();

    // Now the (fired) item advances.
    const advance = await app.request(`/api/ticket-items/${heldItemId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ to: "preparing" }),
    });
    expect(advance.status).toBe(200);
    expect((await queueItemsByDescription(orderId, station)).get(FILETE)!.state).toBe("preparing");
  });

  it("fire with an unknown or malformed course → 404 course.not_found; a malformed order → 404 working_order.not_found", async () => {
    const orderId = await placeOrder([SOPA, FILETE]);

    const unknownCourse = await app.request(`/api/orders/${orderId}/courses/${randomUUID()}/fire`, {
      method: "POST",
      headers: { cookie },
    });
    expect(unknownCourse.status).toBe(404);
    expect(await unknownCourse.json()).toMatchObject({ error: { code: "course.not_found" } });

    const malformedCourse = await app.request(`/api/orders/${orderId}/courses/not-a-uuid/fire`, {
      method: "POST",
      headers: { cookie },
    });
    expect(malformedCourse.status).toBe(404);
    expect(await malformedCourse.json()).toMatchObject({
      error: { code: "course.not_found", params: { courseId: "not-a-uuid" } },
    });

    const malformedOrder = await app.request(`/api/orders/not-a-uuid/courses/${priCourseId}/fire`, {
      method: "POST",
      headers: { cookie },
    });
    expect(malformedOrder.status).toBe(404);
    expect(await malformedOrder.json()).toMatchObject({
      error: { code: "working_order.not_found", params: { workingOrderId: "not-a-uuid" } },
    });
  });

  it("REJECTS the fire route with 401 session.required when no cookie is present", async () => {
    // The guard runs FIRST, before any id screen or DB touch; deleting `requireSession` flips this to a
    // 2xx/4xx (the deletion proof).
    const res = await app.request(`/api/orders/${randomUUID()}/courses/${randomUUID()}/fire`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });
});

// KDS-3 expo (pass) routes: the cross-station queue read + the whole-course `ready`/`away` verbs, over
// the SAME seeded courses/products/station as the KDS-2 block above (shared `suite`/`app`/`cookie`).
type ExpoItem = {
  name: Record<string, string>;
  stationName: string;
  state: string;
  firedAt: string | null;
  awayAt: string | null;
};
type ExpoCourse = {
  courseId: string | null;
  fired: boolean;
  away: boolean;
  items: ExpoItem[];
};
type ExpoOrder = {
  orderId: string;
  courses: ExpoCourse[];
};

/** One order located by id in the expo queue read back through `GET /api/expo/queue`. The queue returns
 *  EVERY live order on the node, so tests find their own by id (the KDS-2 block leaves orders behind). */
async function expoOrder(orderId: string): Promise<ExpoOrder> {
  const res = await app.request("/api/expo/queue", { headers: { cookie } });
  expect(res.status).toBe(200);
  const orders = (await res.json()) as ExpoOrder[];
  return orders.find((o) => o.orderId === orderId)!;
}

/** An expo order's items across ALL its courses, keyed by their `es-ES` description. */
function itemsByDescription(order: ExpoOrder): Map<string, ExpoItem> {
  return new Map(order.courses.flatMap((c) => c.items).map((i) => [i.name["es-ES"]!, i]));
}

describe("KDS-3 expo routes: cross-station queue read + whole-course ready/away", () => {
  it("GET /api/expo/queue aggregates the node's order into courses; each item carries its station name + fired/away roll-ups", async () => {
    const orderId = await placeOrder([SOPA, FILETE, PAN]);
    const order = await expoOrder(orderId);
    const items = itemsByDescription(order);
    expect(items.size).toBe(3);

    // Every item carries the cross-station label the station-scoped read omits (the seeded default "Cocina").
    expect(items.get(SOPA)!.stationName).toBe("Cocina");
    expect(items.get(FILETE)!.stationName).toBe("Cocina");

    // Entrantes auto-fired → its course rolls up fired:true; the held Principales rolls up fired:false.
    const ent = order.courses.find((c) => c.courseId === entCourseId)!;
    const pri = order.courses.find((c) => c.courseId === priCourseId)!;
    expect(ent.fired).toBe(true);
    expect(pri.fired).toBe(false);
    expect(items.get(SOPA)!.firedAt).not.toBeNull();
    expect(items.get(FILETE)!.firedAt).toBeNull();

    // Nothing dispatched yet → away:false everywhere, and the loose PAN line sits in the null course.
    expect(ent.away).toBe(false);
    expect(items.get(SOPA)!.awayAt).toBeNull();
    expect(order.courses.find((c) => c.courseId === null)!.items[0]!.name["es-ES"]).toBe(PAN);
  });

  it("the ready route bumps a fired course to `ready` across stations; the away route then dispatches it", async () => {
    const orderId = await placeOrder([SOPA, FILETE]);

    // Entrantes auto-fired but its items are `queued`; the pass bumps the WHOLE course to ready.
    const ready = await app.request(`/api/orders/${orderId}/courses/${entCourseId}/ready`, {
      method: "POST",
      headers: { cookie },
    });
    expect(ready.status).toBe(200);
    expect(await ready.text()).toBe("");
    expect(itemsByDescription(await expoOrder(orderId)).get(SOPA)!.state).toBe("ready");

    // Dispatch the plated course to the floor → away_at stamped on its ready items.
    const away = await app.request(`/api/orders/${orderId}/courses/${entCourseId}/away`, {
      method: "POST",
      headers: { cookie },
    });
    expect(away.status).toBe(200);
    expect(await away.text()).toBe("");
    // The order survives the read (its held Principales is not away), so the dispatched item is still visible.
    expect(itemsByDescription(await expoOrder(orderId)).get(SOPA)!.awayAt).not.toBeNull();
  });

  it("away → 404 course.not_found for an unknown/malformed course; ready no-ops (200) on an unknown course; a malformed order → 404 working_order.not_found", async () => {
    const orderId = await placeOrder([SOPA]);

    // `away` existence-checks (markCourseAway → requireCourse): an unknown well-formed course → 404.
    const unknownAway = await app.request(`/api/orders/${orderId}/courses/${randomUUID()}/away`, {
      method: "POST",
      headers: { cookie },
    });
    expect(unknownAway.status).toBe(404);
    expect(await unknownAway.json()).toMatchObject({ error: { code: "course.not_found" } });

    // A malformed course id is isUuid-screened to the SAME code on BOTH routes (never a 22P02 → 500).
    const malformedAway = await app.request(`/api/orders/${orderId}/courses/not-a-uuid/away`, {
      method: "POST",
      headers: { cookie },
    });
    expect(malformedAway.status).toBe(404);
    expect(await malformedAway.json()).toMatchObject({
      error: { code: "course.not_found", params: { courseId: "not-a-uuid" } },
    });
    const malformedReady = await app.request(`/api/orders/${orderId}/courses/not-a-uuid/ready`, {
      method: "POST",
      headers: { cookie },
    });
    expect(malformedReady.status).toBe(404);
    expect(await malformedReady.json()).toMatchObject({
      error: { code: "course.not_found", params: { courseId: "not-a-uuid" } },
    });

    // `ready` does NOT existence-check (bumpCourseReady no-throws-on-empty): an unknown well-formed course
    // updates zero rows and returns 200, the same convenience `advanceTicket` makes.
    const unknownReady = await app.request(`/api/orders/${orderId}/courses/${randomUUID()}/ready`, {
      method: "POST",
      headers: { cookie },
    });
    expect(unknownReady.status).toBe(200);

    // A malformed ORDER id on either route → 404 working_order.not_found (never a 22P02 → 500).
    const malformedOrder = await app.request(`/api/orders/not-a-uuid/courses/${entCourseId}/away`, {
      method: "POST",
      headers: { cookie },
    });
    expect(malformedOrder.status).toBe(404);
    expect(await malformedOrder.json()).toMatchObject({
      error: { code: "working_order.not_found", params: { workingOrderId: "not-a-uuid" } },
    });
  });

  it("REJECTS the queue read + ready + away with 401 session.required when no cookie is present", async () => {
    // The `requireSession` guard runs FIRST on each route, before any id screen or DB touch; deleting it
    // flips these to a 2xx/4xx — the deletion proof (run manually, CLAUDE.md §4).
    const queue = await app.request("/api/expo/queue");
    expect(queue.status).toBe(401);
    expect(await queue.json()).toMatchObject({ error: { code: "session.required" } });

    const ready = await app.request(`/api/orders/${randomUUID()}/courses/${randomUUID()}/ready`, {
      method: "POST",
    });
    expect(ready.status).toBe(401);
    expect(await ready.json()).toMatchObject({ error: { code: "session.required" } });

    const away = await app.request(`/api/orders/${randomUUID()}/courses/${randomUUID()}/away`, {
      method: "POST",
    });
    expect(away.status).toBe(401);
    expect(await away.json()).toMatchObject({ error: { code: "session.required" } });
  });
});
