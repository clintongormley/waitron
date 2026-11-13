import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { readBillEditState } from "./bill-editing.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ticketItems,
  parties,
  workingOrderLines,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  seedDeviceProfiles,
  seedKitchenStation,
  seedNode,
  seedVenue,
} from "@waitron/db/testing/seed.js";
import { hashPin, loginWithPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  assignCatalogueToVenue,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { nodeId as brandNodeId } from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { Logger, LogLevel } from "./logger.js";
import { createCourse, setProductCourse } from "./kitchen.js";
import { createTable } from "./testing/live-table.js";
import { mountTillApi } from "./till-api.js";
import { VENUE_SERVICE } from "./modules.js";
import type { TillApiDeps } from "./till-api.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { DEVICE_COOKIE } from "./device-session.js";

import type { PassBoard, PassCard, PassCardItem } from "./pass-card.js";
import { boardCards, boardItems } from "./testing/pass-board-probe.js";
import "./errors.js";
import { seedSessionDevice, sessionCookieForTest } from "./testing/session-device.js";
import type { TradingContext } from "./trading-context.js";

// The HTTP shape of the coursing, fire, station-queue and expo routes: the session guard, the id
// screens and the STATUS mapping. The verbs' logic is pinned in `working-order.test.ts`.
let cfg: TradingContext;
let anna: { id: string };
let starterCourseId: string;
let mainCourseId: string;
// The products offered in the counter zone (a parked order's) and in a tables zone (a tab's). One
// menu serves both zones, so a product's offer is the same id in each.
let counterOffers: ZoneOffers;
let tablesZoneId: string;

// Distinct staff names: the queue serialises the resolved kitchen name, not `productId`, and none of
// these carries a kitchen name of its own, so each falls back to its staff name.
const SOUP = "Sopa"; // Entrantes (earliest) → auto-fires
const STEAK = "Filete"; // Principales (later) → held
const BREAD = "Pan"; // no course → fires immediately

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedLegacySellingUnits(db);
    // invoice_locales is `es-ES` (full-tag, fiscal). The products are authored under the BARE `es`
    // key; `priceOrderLines` re-keys their descriptions to the venue's `es-ES` before the park/place
    // line-insert fires `check_locales`, which demands a line's `descriptions` keys equal the
    // venue's locales exactly.
    await seedVenue(db, {
      name: "Counter",
      invoiceLocales: ["es-ES"],
      operationDescription: "Retail",
    });

    await seedKitchenStation(db, {});
    const nodeId = await seedNode(db);
    const [person] = await seedPersons(db, {
      displayName: "Anna",
      pinHash: hashPin("5555"),
      role: "staff",
    });
    anna = { id: person!.id };
    cfg = makeCfg(nodeId);

    // Through the verbs rather than direct inserts, so the course FK and the active/assignment
    // filters are real.
    await withTransaction(db, async (tx) => {
      const starterCourse = await createCourse(tx, { name: "Entrantes", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Principales", displayOrder: 1 });
      starterCourseId = starterCourse.id;
      mainCourseId = mainCourse.id;
      const catalogue = await createCatalogue(tx, { name: "Carta" });
      const category = await createCategory(tx, { name: "Comida" });
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
      const soupId = await mk(SOUP);
      const steakId = await mk(STEAK);
      await mk(BREAD); // loose — no course assigned
      await setProductCourse(tx, soupId, starterCourse.id);
      await setProductCourse(tx, steakId, mainCourse.id);
      await assignCatalogueToVenue(tx, catalogue.id);
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
function makeCfg(nodeId: string): TradingContext {
  return {
    nodeId: brandNodeId(nodeId),
    locale: "es-ES",
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
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
    admission: testTradingAdmission(),
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
  const deviceId = await seedSessionDevice(db);
  const session = await withTransaction(db, async (tx) => {
    return loginWithPin(tx, {
      deviceId,
      personId: anna.id,
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
let tillDeviceCookie: string;

/** Enrol a REAL `till` device and return its `waitron_device=…` cookie. */
async function enrolTillDeviceCookie(db: Database): Promise<string> {
  const rows = await seedDeviceProfiles(db, { name: "Counter till profile", formFactor: "till" });
  const dev = await enrolDeviceForTest(db, cfg, { name: "Counter till", profileId: rows[0]!.id });
  return `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
}

beforeAll(async () => {
  app = new Hono();
  mountTillApi(app, deps(suite.db), collect([]));
  cookie = await sessionCookieForTest(suite.db, await openSession(suite.db));
  tillDeviceCookie = await enrolTillDeviceCookie(suite.db);
});

/** The seeded default station "Cocina", read back through `GET /api/stations`. */
async function kitchenStationId(): Promise<string> {
  const res = await app.request("/api/stations", { headers: { cookie } });
  expect(res.status).toBe(200);
  const stations = (await res.json()) as { id: string; name: string; isDefault: boolean }[];
  return stations.find((s) => s.isDefault)!.id;
}

/** The order's items at the default station, keyed by their `es-ES` description. */
async function queueItemsByName(orderId: string, station: string): Promise<Map<string, QueueItem>> {
  const res = await app.request(`/api/stations/${station}/queue`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const { items: groups } = (await res.json()) as { items: QueueGroup[] };
  const group = groups.find((g) => g.orderId === orderId)!;
  return new Map(group.items.map((i) => [i.name, i]));
}

async function offerIdsByName(): Promise<Map<string, string>> {
  const res = await app.request(`/api/service-zones/${counterOffers.zoneId}/offers`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  const { offers } = (await res.json()) as { offers: { id: string; name: string }[] };
  const byName = new Map(offers.map((offer) => [offer.name, offer.id]));
  expect([...byName.keys()].sort()).toEqual([SOUP, STEAK, BREAD].sort());
  expect(byName.size).toBe(offers.length);
  return byName;
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

/** Seat a fresh table and send SOUP (Entrantes) as a fired group and STEAK (Principales) as a held
 *  group in one submission; returns the tab id. SOUP is line 1, fired and not started (so
 *  recallable); STEAK is line 2, held. */
async function tabWithSoupAndSteak(): Promise<string> {
  const ids = await offerIdsByName();
  const { id: tableId } = await withTransaction(suite.db, (tx) =>
    createTable(tx, cfg, { label: `Mesa-${randomUUID().slice(0, 8)}`, zoneId: tablesZoneId }),
  );
  const opened = await app.request(`/api/tables/${tableId}/seat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({}),
  });
  expect(opened.status).toBe(200);
  const { tabId, partyId, revision } = (await opened.json()) as {
    tabId: string;
    partyId: string;
    revision: number;
  };
  await withTransaction(suite.db, (tx) =>
    VENUE_SERVICE.writePartyAllergy(tx, partyId, { answer: "none", guests: [] }, anna.id),
  );
  const round = await app.request(`/api/parties/${partyId}/groups`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, tabId)),
      submissionId: randomUUID(),
      expectedPartyRevision: revision,
      groups: [
        { lines: [{ menuItemId: ids.get(SOUP)!, quantity: "1" }], release: "fire" },
        { lines: [{ menuItemId: ids.get(STEAK)!, quantity: "1" }], release: "hold" },
      ],
    }),
  });
  expect(round.status).toBe(200);
  expect(((await round.json()) as { tabId: string }).tabId).toBe(tabId);
  return tabId;
}

async function billBody(tabId: string, body: object): Promise<string> {
  return JSON.stringify({
    ...body,
    expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, tabId)),
  });
}

describe("KDS-2 fire route + station-queue course/firedAt serialisation", () => {
  it("fires every counter course and the loose line while retaining course facts in the queue", async () => {
    const orderId = await placeOrder([SOUP, STEAK, BREAD]);
    const station = await kitchenStationId();
    const items = await queueItemsByName(orderId, station);
    expect(items.size).toBe(3);

    // The loose (courseless) line fires immediately and serialises course: null.
    expect(items.get(BREAD)!.course).toBeNull();
    expect(items.get(BREAD)!.firedAt).not.toBeNull();

    // The earliest course (Entrantes) auto-fires; its item carries the course object + a firedAt.
    expect(items.get(SOUP)!.course).toEqual({
      id: starterCourseId,
      name: "Entrantes",
      displayOrder: 0,
    });
    expect(items.get(SOUP)!.firedAt).not.toBeNull();

    expect(items.get(STEAK)!.course).toEqual({
      id: mainCourseId,
      name: "Principales",
      displayOrder: 1,
    });
    expect(items.get(STEAK)!.firedAt).not.toBeNull();
  });

  it("a HELD item cannot advance (409 ticket.item_held); the waiter releasing its line releases it, and it then advances", async () => {
    const orderId = await tabWithSoupAndSteak();
    const station = await kitchenStationId();
    const heldItemId = (await queueItemsByName(orderId, station)).get(STEAK)!.id;

    // Before firing: the held item is non-advanceable — the kitchen must not bump food not yet started.
    const held = await app.request(`/api/ticket-items/${heldItemId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ to: "preparing", stationId: station }),
    });
    expect(held.status).toBe(409);
    expect(await held.json()).toMatchObject({
      error: { code: "ticket.item_held", params: { ticketItemId: heldItemId } },
    });

    const [bill] = await suite.db
      .select({ partyId: workingOrders.partyId })
      .from(workingOrders)
      .where(eq(workingOrders.id, orderId));
    const [party] = await suite.db
      .select({ revision: parties.revision })
      .from(parties)
      .where(eq(parties.id, bill!.partyId!));
    const [line] = await suite.db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(and(eq(workingOrderLines.workingOrderId, orderId), eq(workingOrderLines.lineNo, 2)));
    const fire = await app.request(`/api/parties/${bill!.partyId}/groups/fire-line`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        submissionId: randomUUID(),
        expectedPartyRevision: party!.revision,
        lineId: line!.id,
      }),
    });
    expect(fire.status).toBe(200);
    expect(await fire.json()).toMatchObject({ revision: party!.revision + 1 });
    expect((await queueItemsByName(orderId, station)).get(STEAK)!.firedAt).not.toBeNull();

    // Now the (fired) item advances.
    const advance = await app.request(`/api/ticket-items/${heldItemId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ to: "preparing", stationId: station }),
    });
    expect(advance.status).toBe(200);
    expect((await queueItemsByName(orderId, station)).get(STEAK)!.state).toBe("preparing");
  });

  it("retired course Fire returns 404 for unknown or malformed targets", async () => {
    const orderId = await placeOrder([SOUP, STEAK]);

    const unknownCourse = await app.request(`/api/orders/${orderId}/courses/${randomUUID()}/fire`, {
      method: "POST",
      headers: { cookie },
    });
    expect(unknownCourse.status).toBe(404);
    expect(await unknownCourse.text()).toBe("404 Not Found");

    const malformedCourse = await app.request(`/api/orders/${orderId}/courses/not-a-uuid/fire`, {
      method: "POST",
      headers: { cookie },
    });
    expect(malformedCourse.status).toBe(404);
    expect(await malformedCourse.text()).toBe("404 Not Found");

    const malformedOrder = await app.request(
      `/api/orders/not-a-uuid/courses/${mainCourseId}/fire`,
      {
        method: "POST",
        headers: { cookie },
      },
    );
    expect(malformedOrder.status).toBe(404);
    expect(await malformedOrder.text()).toBe("404 Not Found");
  });

  it("retired course Fire returns 404 without a session", async () => {
    const res = await app.request(`/api/orders/${randomUUID()}/courses/${randomUUID()}/fire`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("404 Not Found");
  });
});

describe("PATCH /api/working-orders/:id/lines/:lineNo/course (A1 re-course a held line)", () => {
  it("moves the held line to another course (200), then clears it to null, the queue reflecting each", async () => {
    const tabId = await tabWithSoupAndSteak();
    const station = await kitchenStationId();
    // The held Principales line (line 2) carries a Principales course snapshot in the queue.
    expect((await queueItemsByName(tabId, station)).get(STEAK)!.course!.id).toBe(mainCourseId);

    // Move it onto Entrantes.
    const move = await app.request(`/api/working-orders/${tabId}/lines/2/course`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: await billBody(tabId, { courseId: starterCourseId }),
    });
    expect(move.status).toBe(200);
    expect((await queueItemsByName(tabId, station)).get(STEAK)!.course!.id).toBe(starterCourseId);

    // Clear it to null (the courseId === null route branch) — the item now serialises no course.
    const clear = await app.request(`/api/working-orders/${tabId}/lines/2/course`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: await billBody(tabId, { courseId: null }),
    });
    expect(clear.status).toBe(200);
    expect((await queueItemsByName(tabId, station)).get(STEAK)!.course).toBeNull();
  });

  it("an omitted courseId clears the course cleanly (200), never a 500", async () => {
    // An omitted `courseId` means "clear the course": the route coerces it to null
    // (`body.courseId ?? null`) so `undefined` never reaches setLineCourse.
    const tabId = await tabWithSoupAndSteak();
    const station = await kitchenStationId();
    expect((await queueItemsByName(tabId, station)).get(STEAK)!.course!.id).toBe(mainCourseId);

    const res = await app.request(`/api/working-orders/${tabId}/lines/2/course`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: await billBody(tabId, {}),
    });
    expect(res.status).toBe(200);
    expect((await queueItemsByName(tabId, station)).get(STEAK)!.course).toBeNull();
  });

  it("a malformed courseId is 404 course.not_found, screened before any DB touch", async () => {
    // A well-formed tab id + line no, but a non-uuid courseId. No tab is even opened: the screen runs
    // before assertPartyBillOpen.
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

describe("POST /api/working-orders/:id/lines/send (A2 send recalled lines again)", () => {
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

/** The order's cards and dishes on the till's All stations board. */
async function expoOrder(orderId: string): Promise<{ cards: PassCard[]; items: PassCardItem[] }> {
  const res = await app.request("/api/expo/board", { headers: { cookie } });
  expect(res.status).toBe(200);
  const { board } = (await res.json()) as { board: PassBoard };
  return {
    cards: boardCards(board).filter((card) => card.orders.some((o) => o.orderId === orderId)),
    items: boardItems(board).filter((item) => item.orderId === orderId),
  };
}

/** An expo order's items across ALL its courses, keyed by their resolved kitchen name. */
function itemsByName(order: { items: PassCardItem[] }): Map<string, PassCardItem> {
  return new Map(order.items.map((i) => [i.name, i]));
}

describe("KDS-3 expo routes: the All stations board + whole-card ready", () => {
  it("GET /api/expo/board carries every dish of the order; each carries its station name, course and fired time", async () => {
    const orderId = await placeOrder([SOUP, STEAK, BREAD]);
    const order = await expoOrder(orderId);
    const items = itemsByName(order);
    expect(items.size).toBe(3);

    // Every item carries the cross-station label the station-scoped read omits (the seeded default "Cocina").
    expect(items.get(SOUP)!.stationName).toBe("Cocina");
    expect(items.get(STEAK)!.stationName).toBe("Cocina");

    // A course is released when every one of its dishes is fired.
    const inCourse = (courseId: string | null) =>
      order.items.filter((item) => (item.course?.id ?? null) === courseId);
    const starterItems = inCourse(starterCourseId);
    const mainItems = inCourse(mainCourseId);
    expect(starterItems.length).toBeGreaterThan(0);
    expect(mainItems.length).toBeGreaterThan(0);
    expect(starterItems.every((item) => item.firedAt !== null)).toBe(true);
    expect(mainItems.every((item) => item.firedAt !== null)).toBe(true);
    expect(items.get(SOUP)!.firedAt).not.toBeNull();
    expect(items.get(STEAK)!.firedAt).not.toBeNull();

    expect(order.cards.length).toBeGreaterThan(0);
    for (const card of order.cards) expect(card).not.toHaveProperty("away");
    expect(items.get(SOUP)).not.toHaveProperty("awayAt");
    expect(inCourse(null)[0]!.name).toBe(BREAD);
  });

  it("the Ready route still bumps fired food, while retired Away leaves it ready", async () => {
    const orderId = await placeOrder([SOUP, STEAK]);

    // The counter releases both courses; Ready plates both without dispatching.
    const ready = await app.request(`/api/orders/${orderId}/ready`, {
      method: "POST",
      headers: { cookie },
    });
    expect(ready.status).toBe(200);
    expect(await ready.text()).toBe("");
    expect(itemsByName(await expoOrder(orderId)).get(SOUP)!.state).toBe("ready");
    expect(itemsByName(await expoOrder(orderId)).get(STEAK)!.state).toBe("ready");

    const away = await app.request(`/api/orders/${orderId}/courses/${starterCourseId}/away`, {
      method: "POST",
      headers: { cookie },
    });
    expect(away.status).toBe(404);
    expect(await away.text()).toBe("404 Not Found");
    expect(itemsByName(await expoOrder(orderId)).get(SOUP)).not.toHaveProperty("awayAt");
    expect(itemsByName(await expoOrder(orderId)).get(SOUP)!.state).toBe("ready");
  });

  it.each(["queued", "ready", "held", "unknown", "malformed"] as const)(
    "retired course Away cannot dispatch or rewrite %s work on repeated requests",
    async (state) => {
      const orderId =
        state === "held" ? await tabWithSoupAndSteak() : await placeOrder([SOUP, STEAK]);
      if (state === "ready") {
        const ready = await app.request(`/api/orders/${orderId}/ready`, {
          method: "POST",
          headers: { cookie },
        });
        expect(ready.status).toBe(200);
      }
      const courseId =
        state === "held"
          ? mainCourseId
          : state === "unknown"
            ? randomUUID()
            : state === "malformed"
              ? "not-a-uuid"
              : starterCourseId;
      const stored = () =>
        withTransaction(suite.db, async (tx) => ({
          order: await tx.select().from(workingOrders).where(eq(workingOrders.id, orderId)),
          lines: await tx
            .select()
            .from(workingOrderLines)
            .where(eq(workingOrderLines.workingOrderId, orderId)),
          items: await tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, orderId)),
        }));
      const before = await stored();
      expect(before.items).toHaveLength(2);
      if (state === "held") {
        expect(before.items.find((item) => item.courseId === mainCourseId)!.firedAt).toBeNull();
      }
      if (state === "ready") {
        expect(before.items.find((item) => item.courseId === starterCourseId)!.state).toBe("ready");
      }
      for (const sessionCookie of [cookie, ""]) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await app.request(`/api/orders/${orderId}/courses/${courseId}/away`, {
            method: "POST",
            headers: { cookie: sessionCookie },
          });
          expect(response.status).toBe(404);
          expect(await response.text()).toBe("404 Not Found");
          expect(await stored()).toEqual(before);
        }
      }
    },
  );

  it("retires course Ready and Away; bill Ready validates its target and keeps unknown-bill no-op", async () => {
    const orderId = await placeOrder([SOUP]);

    const unknownAway = await app.request(`/api/orders/${orderId}/courses/${randomUUID()}/away`, {
      method: "POST",
      headers: { cookie },
    });
    expect(unknownAway.status).toBe(404);
    expect(await unknownAway.text()).toBe("404 Not Found");

    const malformedAway = await app.request(`/api/orders/${orderId}/courses/not-a-uuid/away`, {
      method: "POST",
      headers: { cookie },
    });
    expect(malformedAway.status).toBe(404);
    expect(await malformedAway.text()).toBe("404 Not Found");
    const malformedReady = await app.request(`/api/orders/${orderId}/courses/not-a-uuid/ready`, {
      method: "POST",
      headers: { cookie },
    });
    expect(malformedReady.status).toBe(404);
    expect(await malformedReady.text()).toBe("404 Not Found");

    const unknownReady = await app.request(`/api/orders/${randomUUID()}/ready`, {
      method: "POST",
      headers: { cookie },
    });
    expect(unknownReady.status).toBe(200);

    // Ready still validates the order id.
    const malformedOrder = await app.request(`/api/orders/not-a-uuid/ready`, {
      method: "POST",
      headers: { cookie },
    });
    expect(malformedOrder.status).toBe(404);
    expect(await malformedOrder.json()).toMatchObject({
      error: { code: "working_order.not_found", params: { workingOrderId: "not-a-uuid" } },
    });
  });

  it("requires sign-in for the board and Ready while Away is retired", async () => {
    const board = await app.request("/api/expo/board");
    expect(board.status).toBe(401);
    expect(await board.json()).toMatchObject({ error: { code: "session.required" } });

    const ready = await app.request(`/api/orders/${randomUUID()}/ready`, {
      method: "POST",
    });
    expect(ready.status).toBe(401);
    expect(await ready.json()).toMatchObject({ error: { code: "session.required" } });

    const away = await app.request(`/api/orders/${randomUUID()}/courses/${randomUUID()}/away`, {
      method: "POST",
    });
    expect(away.status).toBe(404);
    expect(await away.text()).toBe("404 Not Found");
  });
});
