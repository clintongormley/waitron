import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { deviceProfiles, locations, tills, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
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
import type { Logger, LogLevel } from "./logger.js";
import { createCourse, setProductCourse } from "./kitchen.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

// The HTTP shape of the coursing, fire, station-queue and expo routes: the session guard, the id
// screens and the STATUS mapping. The verbs' logic is pinned in `working-order.test.ts`.
let cfg: TillConfig;
let ana: { id: string };
// Entrantes (earliest) auto-fires; Principales is held until `fireCourse`.
let entCourseId: string;
let priCourseId: string;
// The products offered in the counter zone (a parked order's) and in a tables zone (a tab's). One
// menu serves both zones, so a product's offer is the same id in each.
let counterOffers: ZoneOffers;
let tablesZoneId: string;

// Distinct staff names: the queue serialises the resolved kitchen name, not `productId`, and none of
// these carries a kitchen name of its own, so each falls back to its staff name.
const SOPA = "Sopa"; // Entrantes (earliest) → auto-fires
const FILETE = "Filete"; // Principales (later) → held
const PAN = "Pan"; // no course → fires immediately

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    await seedLegacySellingUnits(db);
    // invoice_locales is `es-ES` (full-tag, fiscal). The products are authored under the BARE `es`
    // key; `priceOrderLines` re-keys their descriptions to the location's `es-ES` before the park/place
    // line-insert fires `check_locales`, which demands a line's `descriptions` keys equal the
    // location's locales exactly.
    const [loc] = await db
      .insert(locations)
      .values({ name: "Counter", invoiceLocales: ["es-ES"], operationDescription: "Retail" })
      .returning({ id: locations.id });
    const locationId = brandLocationId(loc!.id);
    await seedKitchenStation(db, { locationId });
    const [till] = await db
      .insert(tills)
      .values({ locationId: loc!.id, name: "Till 1" })
      .returning({ id: tills.id });
    const nodeId = await seedNode(db, locationId);
    const [person] = await db
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    ana = { id: person!.id };
    cfg = makeCfg(till!.id, loc!.id, nodeId);

    // Through the verbs rather than direct inserts, so the course FK and the active/assignment
    // filters are real.
    await withTransaction(db, async (tx) => {
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      entCourseId = ent.id;
      priCourseId = pri.id;
      const catalogue = await createCatalogue(tx, { name: "Carta" });
      const category = await createCategory(tx, { name: { en: "Comida" } });
      const mk = async (description: string): Promise<string> => {
        const p = await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: category.id,
          name: description,
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
      await assignCatalogueToLocation(tx, loc!.id, catalogue.id);
      counterOffers = await offerProducts(tx, cfg);
      tablesZoneId = (await offerProducts(tx, cfg, { zone: "tables" })).zoneId;
    });
  },
});

function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

/** `seriesId` is unused (no fiscal write on the coursing/fire path), so it carries a fresh uuid. */
function makeCfg(tillId: string, locationId: string, nodeId: string): TillConfig {
  return {
    tillId: brandTillId(tillId),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

/** No fiscal doc is filed under this `prepay` cfg, but `placeOrder` calls `clock.now()` regardless. */
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

async function openSession(db: Database): Promise<string> {
  const session = await withTransaction(db, async (tx) => {
    return loginWithPin(tx, {
      tillId: cfg.tillId,
      personId: ana.id,
      pin: "5555",
    });
  });
  return session.token;
}

type QueueCourse = { id: string; name: string; displayOrder: number } | null;
type QueueItem = {
  id: string;
  name: string;
  state: string;
  course: QueueCourse;
  firedAt: string | null;
};
type QueueGroup = { orderId: string; items: QueueItem[] };

let app: Hono;
let cookie: string;
// `POST /:id/place` resolves its `till_id` from the authenticated enrolled device, so `placeOrder`
// carries a `till`-device cookie.
let tillDeviceCookie: string;

/** Enrol a REAL `till` device and return its `waitron_device=…` cookie. */
async function enrolTillDeviceCookie(db: Database): Promise<string> {
  const rows = await db
    .insert(deviceProfiles)
    .values({ name: "Counter till profile", formFactor: "till" })
    .returning({ id: deviceProfiles.id });
  const dev = await enrolDeviceForTest(db, cfg, { name: "Counter till", profileId: rows[0]!.id });
  return `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
}

beforeAll(async () => {
  app = new Hono();
  mountTillApi(app, deps(suite.db), collect([]));
  cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
  tillDeviceCookie = await enrolTillDeviceCookie(suite.db);
});

/** The seeded default station "Cocina", read back through `GET /api/stations`. */
async function cocinaId(): Promise<string> {
  const res = await app.request("/api/stations", { headers: { cookie } });
  expect(res.status).toBe(200);
  const stations = (await res.json()) as { id: string; name: string; isDefault: boolean }[];
  return stations.find((s) => s.isDefault)!.id;
}

/** The order's items at the default station, keyed by their `es-ES` description. */
async function queueItemsByName(orderId: string, station: string): Promise<Map<string, QueueItem>> {
  const res = await app.request(`/api/stations/${station}/queue`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const groups = (await res.json()) as QueueGroup[];
  const group = groups.find((g) => g.orderId === orderId)!;
  return new Map(group.items.map((i) => [i.name, i]));
}

// The queue serialises names, not ids, so the product ids are resolved once, by staff name, and each
// is mapped to its offer so park and round bodies can name it.
async function offerIdsByName(): Promise<Map<string, string>> {
  const res = await app.request("/api/products", { headers: { cookie } });
  expect(res.status).toBe(200);
  const { products } = (await res.json()) as { products: { id: string; name: string }[] };
  return new Map(products.map((p) => [p.name, counterOffers.offerFor(p.id)]));
}

async function placeOrder(names: string[]): Promise<string> {
  const ids = await offerIdsByName();
  const id = randomUUID();
  const park = await app.request("/api/working-orders", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      id,
      zoneId: counterOffers.zoneId,
      lines: names.map((d) => ({ menuItemId: ids.get(d)!, quantity: "1" })),
    }),
  });
  expect(park.status).toBe(200);
  const place = await app.request(`/api/working-orders/${id}/place`, {
    method: "POST",
    headers: { cookie: `${cookie}; ${tillDeviceCookie}` },
  });
  expect(place.status).toBe(200);
  return id;
}

/** Open a fresh-table tab and ring SOPA (Entrantes, auto-fires as line 1) + FILETE (Principales, HELD line
 *  2) as one round; returns the tab id. SOPA is fired-not-started (recallable). */
async function tabWithSopaAndFilete(): Promise<string> {
  const ids = await offerIdsByName();
  const table = await app.request("/api/tables", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ label: `Mesa-${randomUUID().slice(0, 8)}`, zoneId: tablesZoneId }),
  });
  expect(table.status).toBe(200);
  const { id: tableId } = (await table.json()) as { id: string };
  const opened = await app.request(`/api/tables/${tableId}/tab`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({}),
  });
  expect(opened.status).toBe(200);
  const { tabId } = (await opened.json()) as { tabId: string };
  const round = await app.request(`/api/working-orders/${tabId}/round`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      lines: [
        { menuItemId: ids.get(SOPA)!, quantity: "1" },
        { menuItemId: ids.get(FILETE)!, quantity: "1" },
      ],
    }),
  });
  expect(round.status).toBe(200);
  return tabId;
}

describe("KDS-2 fire route + station-queue course/firedAt serialisation", () => {
  it("auto-fires the earliest course + the loose line, holds the later course, and the queue carries course + firedAt", async () => {
    const orderId = await placeOrder([SOPA, FILETE, PAN]);
    const station = await cocinaId();
    const items = await queueItemsByName(orderId, station);
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
    const heldItemId = (await queueItemsByName(orderId, station)).get(FILETE)!.id;

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
    expect((await queueItemsByName(orderId, station)).get(FILETE)!.firedAt).not.toBeNull();

    // Now the (fired) item advances.
    const advance = await app.request(`/api/ticket-items/${heldItemId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ to: "preparing" }),
    });
    expect(advance.status).toBe(200);
    expect((await queueItemsByName(orderId, station)).get(FILETE)!.state).toBe("preparing");
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
    const res = await app.request(`/api/orders/${randomUUID()}/courses/${randomUUID()}/fire`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });
});

describe("PATCH /api/working-orders/:id/lines/:lineNo/course (A1 re-course a held line)", () => {
  it("moves the held line to another course (200), then clears it to null, the queue reflecting each", async () => {
    const tabId = await tabWithSopaAndFilete();
    const station = await cocinaId();
    // The held Principales line (line 2) carries a Principales course snapshot in the queue.
    expect((await queueItemsByName(tabId, station)).get(FILETE)!.course!.id).toBe(priCourseId);

    // Move it onto Entrantes.
    const move = await app.request(`/api/working-orders/${tabId}/lines/2/course`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ courseId: entCourseId }),
    });
    expect(move.status).toBe(200);
    expect((await queueItemsByName(tabId, station)).get(FILETE)!.course!.id).toBe(entCourseId);

    // Clear it to null (the courseId === null route branch) — the item now serialises no course.
    const clear = await app.request(`/api/working-orders/${tabId}/lines/2/course`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ courseId: null }),
    });
    expect(clear.status).toBe(200);
    expect((await queueItemsByName(tabId, station)).get(FILETE)!.course).toBeNull();
  });

  it("an empty {} body (courseId key absent) clears the course cleanly (200), never a 500", async () => {
    // An omitted `courseId` means "clear the course": the route coerces it to null
    // (`body.courseId ?? null`) so `undefined` never reaches setLineCourse.
    const tabId = await tabWithSopaAndFilete();
    const station = await cocinaId();
    expect((await queueItemsByName(tabId, station)).get(FILETE)!.course!.id).toBe(priCourseId);

    const res = await app.request(`/api/working-orders/${tabId}/lines/2/course`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect((await queueItemsByName(tabId, station)).get(FILETE)!.course).toBeNull();
  });

  it("a malformed courseId is 404 course.not_found, screened before any DB touch", async () => {
    // A well-formed tab id + line no, but a non-uuid courseId. No tab is even opened: the screen runs
    // before assertAnchoredTabOpen.
    const res = await app.request(`/api/working-orders/${randomUUID()}/lines/1/course`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ courseId: "not-a-uuid" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "course.not_found", params: { courseId: "not-a-uuid" } },
    });
  });

  it("REJECTS with 401 session.required when no cookie is present", async () => {
    const res = await app.request(`/api/working-orders/${randomUUID()}/lines/1/course`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ courseId: null }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });
});

describe("POST /api/working-orders/:id/lines/send (A2 fire specific held lines / send-all)", () => {
  it("sends a NAMED held line (200) — the queue then shows it fired", async () => {
    const tabId = await tabWithSopaAndFilete();
    const station = await cocinaId();
    // The Principales line (line 2) is held — no fired_at in the station queue yet.
    expect((await queueItemsByName(tabId, station)).get(FILETE)!.firedAt).toBeNull();

    const res = await app.request(`/api/working-orders/${tabId}/lines/send`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ lineNos: [2] }),
    });
    expect(res.status).toBe(200);
    // Sent → fired_at now set, so the kitchen can start it.
    expect((await queueItemsByName(tabId, station)).get(FILETE)!.firedAt).not.toBeNull();
  });

  it("an OMITTED line list sends all held lines (200) — the send-all default", async () => {
    const tabId = await tabWithSopaAndFilete();
    const station = await cocinaId();
    expect((await queueItemsByName(tabId, station)).get(FILETE)!.firedAt).toBeNull();

    // No `lineNos` in the body → `body.lineNos ?? []` → release every held line of the tab.
    const res = await app.request(`/api/working-orders/${tabId}/lines/send`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect((await queueItemsByName(tabId, station)).get(FILETE)!.firedAt).not.toBeNull();
  });

  it("a malformed tab id is 409 tab.not_open, screened by requireTabParam before any DB touch", async () => {
    const res = await app.request(`/api/working-orders/not-a-uuid/lines/send`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ lineNos: [] }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.not_open", params: { tabId: "not-a-uuid" } },
    });
  });

  it("REJECTS with 401 session.required when no cookie is present", async () => {
    const res = await app.request(`/api/working-orders/${randomUUID()}/lines/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineNos: [1] }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });
});

describe("POST /api/working-orders/:id/lines/recall (A4 un-send a not-started line)", () => {
  it("recalls a fired-not-started line (200) — the queue then shows it held again", async () => {
    const tabId = await tabWithSopaAndFilete();
    const station = await cocinaId();
    // SOPA (line 1) auto-fired at round-send — the queue shows it fired.
    expect((await queueItemsByName(tabId, station)).get(SOPA)!.firedAt).not.toBeNull();

    const res = await app.request(`/api/working-orders/${tabId}/lines/recall`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ lineNos: [1] }),
    });
    expect(res.status).toBe(200);
    // Recalled → fired_at cleared, so the line greys back to held on the station display.
    expect((await queueItemsByName(tabId, station)).get(SOPA)!.firedAt).toBeNull();
  });

  it("refuses a STARTED line (409 ticket.already_started), naming its item id", async () => {
    const tabId = await tabWithSopaAndFilete();
    const station = await cocinaId();
    const sopaItemId = (await queueItemsByName(tabId, station)).get(SOPA)!.id;

    // The kitchen begins the (fired) SOPA line — advance it to `preparing` via the bump route.
    const advance = await app.request(`/api/ticket-items/${sopaItemId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ to: "preparing" }),
    });
    expect(advance.status).toBe(200);

    // Recall is now refused — a started line is cancelled, not recalled.
    const res = await app.request(`/api/working-orders/${tabId}/lines/recall`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ lineNos: [1] }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "ticket.already_started", params: { ticketItemId: sopaItemId } },
    });
  });

  it("a body naming no lines recalls nothing (200) — the fired line stays fired", async () => {
    const tabId = await tabWithSopaAndFilete();
    const station = await cocinaId();

    const res = await app.request(`/api/working-orders/${tabId}/lines/recall`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect((await queueItemsByName(tabId, station)).get(SOPA)!.firedAt).not.toBeNull();
  });

  it("a malformed tab id is 409 tab.not_open, screened by requireTabParam before any DB touch", async () => {
    const res = await app.request(`/api/working-orders/not-a-uuid/lines/recall`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ lineNos: [1] }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.not_open", params: { tabId: "not-a-uuid" } },
    });
  });

  it("REJECTS with 401 session.required when no cookie is present", async () => {
    const res = await app.request(`/api/working-orders/${randomUUID()}/lines/recall`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineNos: [1] }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });
});

// KDS-3 expo (pass) routes: the cross-station queue read + the whole-course `ready`/`away` verbs, over
// the SAME seeded courses/products/station as the KDS-2 block above (shared `suite`/`app`/`cookie`).
type ExpoItem = {
  name: string;
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

/** An expo order's items across ALL its courses, keyed by their resolved kitchen name. */
function itemsByName(order: ExpoOrder): Map<string, ExpoItem> {
  return new Map(order.courses.flatMap((c) => c.items).map((i) => [i.name, i]));
}

describe("KDS-3 expo routes: cross-station queue read + whole-course ready/away", () => {
  it("GET /api/expo/queue aggregates the node's order into courses; each item carries its station name + fired/away roll-ups", async () => {
    const orderId = await placeOrder([SOPA, FILETE, PAN]);
    const order = await expoOrder(orderId);
    const items = itemsByName(order);
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
    expect(order.courses.find((c) => c.courseId === null)!.items[0]!.name).toBe(PAN);
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
    expect(itemsByName(await expoOrder(orderId)).get(SOPA)!.state).toBe("ready");

    // Dispatch the plated course to the floor → away_at stamped on its ready items.
    const away = await app.request(`/api/orders/${orderId}/courses/${entCourseId}/away`, {
      method: "POST",
      headers: { cookie },
    });
    expect(away.status).toBe(200);
    expect(await away.text()).toBe("");
    // The order survives the read (its held Principales is not away), so the dispatched item is still visible.
    expect(itemsByName(await expoOrder(orderId)).get(SOPA)!.awayAt).not.toBeNull();
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

    // A malformed course id is isUuid-screened to the SAME code on BOTH routes.
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

    // A malformed ORDER id on either route → 404 working_order.not_found.
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
