import { observedOrderWriteBody } from "./testing/order-writer-fixture.js";
import { observedDraftCommandBody } from "./testing/draft-command-fixture.js";
import { observedGroupSubmitBody } from "./testing/group-submit-fixture.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { expect, it } from "vitest";
import {
  kitchenTimingDefaults,
  locations,
  ticketItems,
  workingOrderLines,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  createExtraList,
  updateProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import { locationId as brandLocationId, nodeId as brandNodeId } from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { createCourse, createStation, setProductCourse } from "./kitchen.js";
import { createTable } from "./testing/live-table.js";
import { mountTillApi } from "./till-api.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts, routeProductTo } from "./testing/zone-offers.js";
import { SESSION_COOKIE } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";
import { seedSessionDevice } from "./testing/session-device.js";

import { deleteCourse } from "./course-delete.js";
import { republishMenus } from "./testing/publish-menu.js";
import { priceTabRound } from "./working-order.js";
import { RETAINED_COURSE } from "./retained-course.js";
import type { Draft } from "./order-drafts.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const clock: TrustedClock = {
  now: () => ({
    instant: new Date(),
    offsetMinutes: 0,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("not used on course retention paths");
  },
  currentAnchor: () => null,
};
async function setup() {
  const db = suite.db;
  await seedTenant(db);
  await seedLegacySellingUnits(db);
  const [loc] = await db
    .insert(locations)
    .values({ name: "Sala", invoiceLocales: ["es-ES"], operationDescription: "Restaurant" })
    .returning();
  const locationId = brandLocationId(loc!.id);
  await db.insert(kitchenTimingDefaults).values({ locationId });
  const stationId = await seedKitchenStation(db, { locationId });
  const nodeId = await seedNode(db, locationId);
  const cfg: TillConfig = {
    nodeId: brandNodeId(nodeId),
    locationId,
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const [ana, sam] = await db
    .insert(persons)
    .values([
      { displayName: "Ana", pinHash: hashPin("5555"), role: "staff" },
      { displayName: "Sam", pinHash: hashPin("6666"), role: "staff" },
    ])
    .returning();
  const stocked = await withTransaction(db, async (tx) => {
    const early = await createCourse(tx, cfg, { name: "Starters", displayOrder: 0 });
    const late = await createCourse(tx, cfg, { name: "Recorded mains", displayOrder: 7 });
    const other = await createCourse(tx, cfg, { name: "Other deleted", displayOrder: 9 });
    const catalogue = await createCatalogue(tx, { name: "Menu" });
    const category = await createCategory(tx, { name: "Food" });
    const dish = await createProduct(tx, {
      catalogueId: catalogue.id,
      categoryId: category.id,
      name: "Staff steak",
      kitchenName: "K-STEAK",
      customerName: { es: "Customer steak" },
      pricingUnit: "each",
      unitPrice: "12.00",
      vatClass: "general",
    });
    const sauce = await createProduct(tx, {
      catalogueId: catalogue.id,
      categoryId: category.id,
      name: "Staff sauce",
      kitchenName: "K-SAUCE",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const list = await createExtraList(
      tx,
      {
        name: "Sauces",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 1,
        active: true,
        items: [{ productId: sauce.id, maxQuantity: 1, preselected: false, price: "1.50" }],
      },
      "es-ES",
    );
    await writeProductModifiers(tx, dish.id, [{ kind: "extras", id: list.id }]);
    await setProductCourse(tx, cfg, dish.id, late.id);
    // Keep a reference so deletion retains the other row as well.
    await setProductCourse(tx, cfg, sauce.id, other.id);
    await assignCatalogueToLocation(tx, locationId, catalogue.id);
    const offers = await offerProducts(tx, cfg, { zone: "tables" });
    const counter = await offerProducts(tx, cfg);
    return { early, late, other, dish, sauce, list, offers, counter };
  });
  const app = new Hono();
  mountTillApi(
    app,
    { db, backend: {} as FiscalBackend, clock, cfg, secureCookies: false, venueLocale: "es-ES" },
    () => {},
  );
  async function session(person: typeof ana, pin: string) {
    const deviceId = await seedSessionDevice(db, cfg);
    const token = await withTransaction(db, (tx) =>
      loginWithPin(tx, { deviceId, personId: person!.id, pin }),
    );
    return `${SESSION_COOKIE}=${token.token}`;
  }
  const cookie = await session(ana, "5555");
  const samCookie = await session(sam, "6666");
  async function request(path: string, method = "GET", body?: unknown, chosenCookie = cookie) {
    return app.request(path, {
      method,
      headers: { cookie: chosenCookie, "content-type": "application/json" },
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(
              await observedDraftCommandBody(
                db,
                method,
                path,
                await observedOrderWriteBody(
                  db,
                  method,
                  path,
                  await observedGroupSubmitBody(db, path, body),
                ),
              ),
            ),
          }),
    });
  }
  async function seat() {
    const table = await withTransaction(db, (tx) =>
      createTable(tx, cfg, { label: randomUUID(), zoneId: stocked.offers.zoneId }),
    );
    const res = await request(`/api/tables/${table.id}/seat`, "POST", {});
    expect(res.status).toBe(200);
    return (await res.json()) as { partyId: string; tabId: string; revision: number };
  }
  const seated = await seat();
  const line = (
    courseId: string | null = stocked.late.id,
    patch: Record<string, unknown> = {},
  ) => ({
    menuItemId: stocked.offers.offerFor(stocked.dish.id),
    quantity: "1",
    courseId,
    ...patch,
  });
  async function save(
    lines: unknown[],
    draft?: Draft,
    chosenCookie = cookie,
    partyId = seated.partyId,
  ) {
    return request(
      `/api/parties/${partyId}/drafts`,
      "PUT",
      { billId: seated.tabId, draftId: draft?.id ?? null, revision: draft?.revision ?? 0, lines },
      chosenCookie,
    );
  }
  async function saved(lines: unknown[]) {
    const res = await save(lines);
    expect(res.status).toBe(200);
    return ((await res.json()) as { draft: Draft }).draft;
  }
  async function remove(id = stocked.late.id) {
    await withTransaction(db, (tx) => deleteCourse(tx, cfg, id));
  }
  async function submit(draft: Draft, release = "hold") {
    return request(`/api/parties/${seated.partyId}/drafts/${draft.id}/submit`, "POST", {
      submissionId: randomUUID(),
      expectedPartyRevision: seated.revision,
      draftRevision: draft.revision,
      groups: [{ lineIds: draft.lines.map((x) => x.id), release }],
    });
  }
  async function snapshot() {
    const tables = await db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' order by name`,
    );
    const rows: Record<string, unknown[]> = {};
    // The session guard records a device sighting before the request's transaction.
    for (const { name } of tables) {
      const stored = await db.all<Record<string, unknown>>(
        sql`select * from ${sql.identifier(name)} order by rowid`,
      );
      rows[name] =
        name === "devices"
          ? stored.map((row) => {
              const copy = { ...row };
              delete copy.last_seen_at;
              return copy;
            })
          : stored;
    }
    return rows;
  }
  async function refused(attempt: () => Promise<Response>, code: string, status = 404) {
    const before = await snapshot();
    const res = await attempt();
    expect(await res.json()).toMatchObject({ error: { code } });
    expect(res.status).toBe(status);
    expect(await snapshot()).toEqual(before);
  }
  async function queue(orderId = seated.tabId) {
    const res = await request(`/api/stations/${stationId}/queue`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: {
        orderId: string;
        items: {
          id: string;
          name: string;
          course: { id: string; name: string; displayOrder: number } | null;
          firedAt: string | null;
          state: string;
          modifiers: {
            descriptions: Record<string, string>;
            addAllergens: unknown;
            suitableFor: string[];
          }[];
        }[];
      }[];
    };
    return body.items.find((x) => x.orderId === orderId)!.items;
  }
  return {
    db,
    cfg,
    stationId,
    ...stocked,
    ...seated,
    line,
    save,
    saved,
    remove,
    submit,
    refused,
    request,
    seat,
    samCookie,
    queue,
    snapshot,
  };
}

it("saved draft keeps and submits its deleted course", async () => {
  const v = await setup();
  let draft = await v.saved([
    v.line(undefined, {
      extras: [{ listId: v.list.id, picks: [{ productId: v.sauce.id, quantity: 1 }] }],
    }),
  ]);
  await v.remove();
  const res = await v.save(
    [v.line(v.late.id.toUpperCase(), { quantity: "2", extras: draft.lines[0]!.extras })],
    draft,
  );
  expect(res.status).toBe(200);
  draft = ((await res.json()) as { draft: Draft }).draft;
  expect(draft.lines[0]!.courseId).toBe(v.late.id);
  expect(draft.lines[0]!.quantity).toBe("2.000");
  const send = await v.submit(draft);
  expect(await send.json()).toMatchObject({ draft: null });
  expect(send.status).toBe(200);
  const rows = await v.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, v.tabId));
  expect(rows.map((x) => [x.productId, x.courseId, x.quantity])).toEqual([
    [v.dish.id, v.late.id, 2000],
    [v.sauce.id, null, 2000],
  ]);
  const items = await v.queue();
  expect(items.map((x) => [x.name, x.course, x.firedAt])).toEqual([
    ["K-STEAK", { id: v.late.id, name: "Recorded mains", displayOrder: 7 }, null],
  ]);
  expect(items[0]!.modifiers).toEqual([
    { descriptions: { "es-ES": "Staff sauce" }, addAllergens: null, suitableFor: [] },
  ]);
  const tickets = await v.db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, v.tabId));
  expect(tickets.map((row) => [row.courseId, row.quantity, row.firedAt])).toEqual([
    [v.late.id, 2000, null],
  ]);
});
it("held deleted course fires with its original name and sequence", async () => {
  const v = await setup();
  const draft = await v.saved([v.line()]);
  const send = await v.submit(draft);
  expect(send.status).toBe(200);
  await v.remove();
  expect((await v.queue())[0]!.course).toEqual({
    id: v.late.id,
    name: "Recorded mains",
    displayOrder: 7,
  });
  expect((await v.queue())[0]!.firedAt).toBeNull();
  const fire = await v.request(`/api/orders/${v.tabId}/courses/${v.late.id}/fire`, "POST");
  expect(fire.status).toBe(200);
  expect((await v.queue())[0]!.firedAt).not.toBeNull();
  expect((await v.queue())[0]!.course).toEqual({
    id: v.late.id,
    name: "Recorded mains",
    displayOrder: 7,
  });
});
it("quantity-only open-order edit retains deleted course without repricing saved facts", async () => {
  const v = await setup();
  const draft = await v.saved([v.line()]);
  expect((await v.submit(draft)).status).toBe(200);
  await v.remove();
  await withTransaction(v.db, async (tx) => {
    await updateProduct(tx, v.dish.id, { unitPrice: "20.00" });
    await republishMenus(tx);
  });
  const live = await withTransaction(v.db, (tx) =>
    priceTabRound(tx, v.cfg, v.tabId, [v.line(null)]),
  );
  expect(live.rows[0]!.unitPriceGross).toBe(2000);
  const [before] = await v.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, v.tabId));
  const [order] = await v.db.select().from(workingOrders).where(eq(workingOrders.id, v.tabId));
  const res = await v.request(`/api/working-orders/${v.tabId}/lines/1`, "PUT", {
    revision: order!.revision,
    quantity: "2",
  });
  expect(res.status).toBe(200);
  const [after] = await v.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.id, before!.id));
  expect(after).toEqual({ ...before, quantity: 2000, lineTotal: 2400 });
  expect((await v.queue())[0]!.course).toEqual({
    id: v.late.id,
    name: "Recorded mains",
    displayOrder: 7,
  });
});
for (const mode of ["new draft", "new basket", "new line"] as const)
  it(`${mode} cannot choose deleted course`, async () => {
    const v = await setup();
    await v.remove();
    await v.refused(
      () =>
        mode === "new draft"
          ? v.save([v.line()])
          : mode === "new basket"
            ? v.request("/api/working-orders", "POST", {
                id: randomUUID(),
                zoneId: v.counter.zoneId,
                lines: [
                  { ...v.line(), menuItemId: v.counter.offerFor(v.dish.id), retainedCourse: true },
                ],
              })
            : v.request(`/api/parties/${v.partyId}/groups`, "POST", {
                submissionId: randomUUID(),
                expectedPartyRevision: v.revision,
                groups: [{ release: "hold", lines: [{ ...v.line(), retainedCourse: true }] }],
              }),
      "course.not_found",
    );
    expect(await v.db.select().from(ticketItems)).toEqual([]);
  });
for (const mode of [
  "wrong party",
  "stale revision",
  "another person's draft",
  "new second selection",
  "different deleted course",
  "different variant",
  "different menu item",
] as const)
  it(`does not retain ${mode}`, async () => {
    const v = await setup();
    const draft = await v.saved([v.line()]);
    await v.remove();
    await v.remove(v.other.id);
    const otherParty = await v.seat();
    let lines = [v.line()];
    if (mode === "new second selection")
      lines = [v.line(), v.line(v.late.id, { note: "new separate choice", noMerge: true })];
    if (mode === "different deleted course") lines = [v.line(v.other.id)];
    if (mode === "different variant") lines = [v.line(v.late.id, { variantId: randomUUID() })];
    if (mode === "different menu item")
      lines = [v.line(v.late.id, { menuItemId: v.offers.offerFor(v.sauce.id) })];
    const edited = mode === "stale revision" ? { ...draft, revision: draft.revision + 1 } : draft;
    const code =
      mode === "wrong party"
        ? "draft.not_found"
        : mode === "stale revision"
          ? "draft.out_of_date"
          : mode === "another person's draft"
            ? "draft.taken_over"
            : "course.not_found";
    await v.refused(
      () =>
        v.save(
          lines,
          edited,
          mode === "another person's draft" ? v.samCookie : undefined,
          mode === "wrong party" ? otherParty.partyId : undefined,
        ),
      code,
      ["draft.out_of_date", "draft.taken_over"].includes(code) ? 409 : 404,
    );
  });
it("new product choice after its default clears is course-free and fires earliest", async () => {
  const v = await setup();
  await v.remove();
  const id = randomUUID();
  const parked = await v.request("/api/working-orders", "POST", {
    id,
    zoneId: v.counter.zoneId,
    lines: [
      { menuItemId: v.counter.offerFor(v.dish.id), quantity: "1" },
      { menuItemId: v.counter.offerFor(v.sauce.id), quantity: "1" },
    ],
  });
  expect(parked.status).toBe(200);
  const placed = await v.request(`/api/working-orders/${id}/place`, "POST");
  expect(placed.status).toBe(200);
  const items = await v.queue(id);
  expect(items.find((item) => item.name === "K-STEAK")!.course).toBeNull();
  expect(items.find((item) => item.name === "K-STEAK")!.firedAt).not.toBeNull();
});

it("one retained pricing line never authorises a fresh line of the same deleted course", async () => {
  const v = await setup();
  await v.remove();
  const before = await v.snapshot();
  await expect(
    withTransaction(v.db, (tx) =>
      priceTabRound(tx, v.cfg, v.tabId, [
        { ...v.line(), [RETAINED_COURSE]: true },
        v.line(v.late.id, { note: "fresh" }),
      ]),
    ),
  ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: v.late.id } });
  expect(await v.snapshot()).toEqual(before);
  expect(await v.db.select().from(ticketItems)).toEqual([]);
});
it("quantity added to a fired dish keeps its deleted course on the new portion", async () => {
  const v = await setup();
  const draft = await v.saved([v.line()]);
  expect((await v.submit(draft, "fire")).status).toBe(200);
  await v.remove();
  const [order] = await v.db.select().from(workingOrders).where(eq(workingOrders.id, v.tabId));
  const res = await v.request(`/api/working-orders/${v.tabId}/lines/1`, "PUT", {
    revision: order!.revision,
    quantity: "2",
  });
  expect(res.status).toBe(200);
  const rows = await v.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, v.tabId));
  expect(
    rows.map((row) => [row.courseId, row.quantity, row.unitPriceGross, row.lineTotal]),
  ).toEqual([
    [v.late.id, 1000, 1200, 1200],
    [v.late.id, 1000, 1200, 1200],
  ]);
  expect((await v.queue()).map((row) => [row.course, row.firedAt === null])).toEqual([
    [{ id: v.late.id, name: "Recorded mains", displayOrder: 7 }, false],
    [{ id: v.late.id, name: "Recorded mains", displayOrder: 7 }, false],
  ]);
});

it("routing preview of a saved draft keeps its deleted course", async () => {
  const v = await setup();
  const draft = await v.saved([v.line()]);
  await v.remove();
  const before = await v.snapshot();
  const res = await v.request("/api/dead-ends/draft", "POST", {
    partyId: v.partyId,
    draftId: draft.id,
    lineIds: draft.lines.map((line) => line.id),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ sends: true, deadEnds: [] });
  expect(await v.snapshot()).toEqual(before);
});

it("routed child extras inherit and release their dish's retained deleted course", async () => {
  const v = await setup();
  const station = await withTransaction(v.db, async (tx) => {
    const station = await createStation(tx, v.cfg, { name: "Sauce kitchen" });
    await routeProductTo(tx, v.cfg, v.sauce.id, station.id);
    return station;
  });
  const draft = await v.saved([
    v.line(v.late.id, {
      extras: [{ listId: v.list.id, picks: [{ productId: v.sauce.id, quantity: 1 }] }],
    }),
  ]);
  await v.remove();
  expect((await v.submit(draft)).status).toBe(200);
  const rows = await v.db.select().from(ticketItems).where(eq(ticketItems.workingOrderId, v.tabId));
  expect(rows.map((row) => [row.stationId, row.courseId, row.quantity, row.firedAt])).toEqual([
    [v.stationId, v.late.id, 1000, null],
    [station.id, v.late.id, 1000, null],
  ]);
  expect(rows[0]!.stationId).not.toBe(station.id);
  expect((await v.request(`/api/orders/${v.tabId}/courses/${v.late.id}/fire`, "POST")).status).toBe(
    200,
  );
  const released = await v.db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, v.tabId));
  expect(released.map((row) => [row.id, row.courseId, row.firedAt === null])).toEqual(
    rows.map((row) => [row.id, v.late.id, false]),
  );
});
